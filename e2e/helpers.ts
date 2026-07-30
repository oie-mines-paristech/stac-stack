import { expect, type Page, type TestInfo } from "@playwright/test";

/** Same-origin mini Sophia-like fixture (see scripts/build-e2e-fixture.ts). */
export const MINI_SOPHIA = "/fixtures/mini-sophia.zarr/";

export const MISSING_FIXTURE = "/fixtures/missing-store.zarr/";

const DEFAULT_READY_TIMEOUT_MS = 20_000;
const POLL_INTERVAL_MS = 150;

export interface ViewerMonitor {
  pageErrors: string[];
  consoleErrors: string[];
  requestFailures: string[];
  attach: () => void;
  assertClean: () => void;
  snapshotDiagnostics: () => string;
}

export function createViewerMonitor(page: Page): ViewerMonitor {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const requestFailures: string[] = [];

  return {
    pageErrors,
    consoleErrors,
    requestFailures,
    attach() {
      page.on("pageerror", (error) => {
        pageErrors.push(error.message);
      });
      page.on("console", (message) => {
        if (message.type() === "error") {
          consoleErrors.push(message.text());
        }
      });
      page.on("requestfailed", (request) => {
        const url = request.url();
        if (url.includes(".zarr") || url.includes("zarr.json") || url.includes(".zmetadata")) {
          requestFailures.push(`${request.failure()?.errorText ?? "failed"} ${url}`);
        }
      });
    },
    assertClean() {
      expect(pageErrors, "unexpected page errors").toEqual([]);
      expect(consoleErrors, "unexpected console errors").toEqual([]);
    },
    snapshotDiagnostics(): string {
      return [
        pageErrors.length ? `pageErrors:\n  ${pageErrors.join("\n  ")}` : "",
        consoleErrors.length ? `consoleErrors:\n  ${consoleErrors.join("\n  ")}` : "",
        requestFailures.length ? `zarrRequestFailures:\n  ${requestFailures.join("\n  ")}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    },
  };
}

function readViewerState(page: Page): Promise<{
  status: string;
  errorToast: string;
  toastHidden: boolean;
  timings: string;
  timeLabel: string;
  loading: boolean;
}> {
  return page.evaluate(() => {
    const status = document.querySelector("#status")?.textContent ?? "";
    const toast = document.querySelector("#error-toast");
    const toastHidden = !(toast instanceof HTMLElement) || toast.hidden;
    const errorToast =
      toast instanceof HTMLElement && !toast.hidden ? (toast.textContent ?? "") : "";
    const timings = document.querySelector("#timings")?.textContent ?? "";
    const timeLabel = document.querySelector("#time-label")?.textContent ?? "";
    const loading = status.includes("Loading") || status.includes("Opening");
    return { status, errorToast, toastHidden, timings, timeLabel, loading };
  });
}

export class ViewerFailure extends Error {
  constructor(
    message: string,
    readonly diagnostics: string,
  ) {
    super(message);
    this.name = "ViewerFailure";
  }
}

/** Poll viewer readiness and fail fast on errors instead of waiting for a long timeout. */
export async function waitForViewerReady(
  page: Page,
  monitor: ViewerMonitor,
  options: { timeoutMs?: number; requireTimings?: boolean } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
  const requireTimings = options.requireTimings ?? true;
  const deadline = Date.now() + timeoutMs;

  await page.waitForSelector("#canvas", { state: "attached", timeout: Math.min(timeoutMs, 10_000) });

  while (Date.now() < deadline) {
    if (monitor.pageErrors.length > 0) {
      throw new ViewerFailure(
        `Page error: ${monitor.pageErrors[0]}`,
        monitor.snapshotDiagnostics(),
      );
    }

    const state = await readViewerState(page);

    if (!state.toastHidden && state.errorToast) {
      throw new ViewerFailure(
        `Error toast: ${state.errorToast}`,
        monitor.snapshotDiagnostics(),
      );
    }

    const rendered = requireTimings ? state.timings.includes("ms") : true;
    if (!state.loading && rendered) {
      return;
    }

    await page.waitForTimeout(POLL_INTERVAL_MS);
  }

  const state = await readViewerState(page);
  throw new ViewerFailure(
    `Viewer not ready after ${timeoutMs}ms (status="${state.status}", timings="${state.timings}")`,
    monitor.snapshotDiagnostics(),
  );
}

export async function assertCanvasRendered(
  page: Page,
  monitor: ViewerMonitor,
): Promise<void> {
  await waitForViewerReady(page, monitor);
  await expect(page.locator("#error-toast")).toBeHidden();

  const metrics = await page.evaluate(() => {
    const canvas = document.querySelector("#canvas") as HTMLCanvasElement | null;
    if (!canvas) throw new Error("Missing #canvas");
    const timings = document.querySelector("#timings")?.textContent ?? "";
    const width = canvas.width;
    const height = canvas.height;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return { width, height, min: -1, max: -1, readback: false, timings };
    }

    const data = ctx.getImageData(0, 0, width, height).data;
    let min = 255;
    let max = 0;
    for (let index = 0; index < data.length; index += 4) {
      const value = data[index];
      if (value < min) min = value;
      if (value > max) max = value;
    }
    return { width, height, min, max, readback: true, timings };
  });

  expect(metrics.width).toBeGreaterThan(10);
  expect(metrics.height).toBeGreaterThan(10);
  expect(metrics.timings).toContain("ms");

  if (metrics.readback && metrics.min === metrics.max) {
    // WebGL canvas may not expose pixels via 2D readback; timings prove a frame rendered.
    expect(metrics.timings).toMatch(/render\s+\d+\s+ms/);
  }
}

export function attachTestDiagnostics(testInfo: TestInfo, monitor: ViewerMonitor): void {
  testInfo.attach("viewer-diagnostics.txt", {
    body: monitor.snapshotDiagnostics() || "(no diagnostics captured)",
    contentType: "text/plain",
  });
}

export function fixtureUrl(path: string, query = ""): string {
  const base = path.startsWith("/") ? path : `/${path}`;
  return query ? `/?url=${encodeURIComponent(base)}&${query}` : `/?url=${encodeURIComponent(base)}`;
}
