import { expect, test } from "@playwright/test";

const SOPHIA =
  "https://demos.oie-lab.net/stac/data/fisheye/sophia.zarr/";

async function waitForFrameReady(page: import("@playwright/test").Page): Promise<void> {
  await page.waitForSelector("#canvas", { state: "attached" });
  await page.waitForFunction(() => {
    const status = document.querySelector("#status")?.textContent ?? "";
    const toast = document.querySelector("#error-toast");
    const hasError = toast instanceof HTMLElement && !toast.hidden && toast.textContent !== "";
    return (
      !hasError &&
      !status.includes("Loading") &&
      !status.includes("Opening")
    );
  }, { timeout: 90_000 });
}

async function assertCanvasRendered(
  page: import("@playwright/test").Page,
): Promise<void> {
  await waitForFrameReady(page);
  await expect(page.locator("#error-toast")).toBeHidden();

  const metrics = await page.evaluate(() => {
    const canvas = document.querySelector("#canvas") as HTMLCanvasElement;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Missing 2D context");

    const { width, height } = canvas;
    const data = ctx.getImageData(0, 0, width, height).data;
    let min = 255;
    let max = 0;
    for (let i = 0; i < data.length; i += 4) {
      const value = data[i];
      if (value < min) min = value;
      if (value > max) max = value;
    }
    return { width, height, min, max };
  });

  expect(metrics.width).toBeGreaterThan(100);
  expect(metrics.height).toBeGreaterThan(100);
  expect(metrics.max).toBeGreaterThan(metrics.min);
}

function collectPageErrors(page: import("@playwright/test").Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

test("default page shows idle prompt", async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto("/");
  await expect(page.locator("#viewer-idle")).toBeVisible();
  await expect(page.locator("#viewer-idle")).toContainText("Enter a store URL");
  await expect(page.locator("#url-input")).toHaveValue("");
  await expect(page.locator("#url-input")).not.toHaveValue(/demos\.oie-lab\.net/);
  expect(errors).toEqual([]);
});

test("url query param serves the app and renders canvas", async ({ page }) => {
  const errors = collectPageErrors(page);
  const target = `/?url=${encodeURIComponent(SOPHIA)}`;
  const response = await page.goto(target);
  expect(response?.status()).toBe(200);
  await expect(page.locator("body")).not.toContainText("403 Restricted");
  await assertCanvasRendered(page);
  expect(errors).toEqual([]);
});

test("path-only url is accepted in query param", async ({ page }) => {
  const target = `/?url=${encodeURIComponent("/stac/data/fisheye/sophia.zarr/")}`;
  await page.goto(target);
  await expect(page.locator("#url-input")).toHaveValue("/stac/data/fisheye/sophia.zarr/");
  await expect(page.locator("#error-toast")).toBeVisible();
  await expect(page.locator("#error-toast")).not.toContainText("Invalid URL");
});

test("legacy query param migrates to hash in the address bar", async ({ page }) => {
  const target = `/?url=${encodeURIComponent(SOPHIA)}&variable=radiance`;
  await page.goto(target);
  await waitForFrameReady(page);
  await expect(page).toHaveURL(/^[^?]*#/);
  expect(new URL(page.url()).search).toBe("");
  await expect(page.locator("#variable-select")).toHaveValue("radiance");
});

test("shared url restores variable and datetime", async ({ page }) => {
  const target =
    `/?url=${encodeURIComponent(SOPHIA)}` +
    "&variable=overexposure_mask&datetime=2024-06-16T12:00:00Z&rgb=0,2,3&autoscale=0";
  await page.goto(target);
  await assertCanvasRendered(page);
  await expect(page.locator("#variable-select")).toHaveValue("overexposure_mask");
  await expect(page.locator("#rgb-bands")).toBeVisible();
  await expect(page.locator("#autoscale")).not.toBeChecked();
  await expect(page).toHaveURL(/^[^?]*#/);
});

test("manual scale min/max is persisted in hash url", async ({ page }) => {
  await page.goto(`/?url=${encodeURIComponent(SOPHIA)}`);
  await waitForFrameReady(page);
  const hashBefore = await page.evaluate(() => window.location.hash);

  await page.locator("#autoscale").uncheck();
  await expect(page.locator("#scale-controls")).toBeVisible();

  const minInput = page.locator('.scale-input[data-bound="min"]').first();
  const maxInput = page.locator('.scale-input[data-bound="max"]').first();
  await minInput.fill("100");
  await maxInput.fill("200");
  await maxInput.blur();

  await page.waitForFunction(
    (before) => window.location.hash.length > 1 && window.location.hash !== before,
    hashBefore,
    { timeout: 15_000 },
  );

  const shareUrl = await page.evaluate(() => window.location.pathname + window.location.hash);
  await page.goto(shareUrl);
  await waitForFrameReady(page);

  await expect(page.locator("#autoscale")).not.toBeChecked();
  await expect(minInput).toHaveValue("100");
  await expect(maxInput).toHaveValue("200");
});
