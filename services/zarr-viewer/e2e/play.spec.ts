import { expect, test } from "@playwright/test";
import {
  attachTestDiagnostics,
  createViewerMonitor,
  fixtureUrl,
  MINI_SOPHIA,
  waitForViewerReady,
} from "./helpers.js";

test.afterEach(async ({}, testInfo) => {
  const monitor = (testInfo as { _monitor?: ReturnType<typeof createViewerMonitor> })._monitor;
  if (monitor) attachTestDiagnostics(testInfo, monitor);
});

test("play advances multiple frames", async ({ page }, testInfo) => {
  const monitor = createViewerMonitor(page);
  monitor.attach();
  (testInfo as { _monitor?: typeof monitor })._monitor = monitor;

  await page.goto(fixtureUrl(MINI_SOPHIA, "variable=radiance"));
  await waitForViewerReady(page, monitor);
  await expect(page.locator("#playback-controls")).toBeVisible();

  const before = (await page.locator("#time-label").textContent()) ?? "";
  expect(before).toContain("UTC");

  await page.locator("#btn-play-pause").click();
  await expect(page.locator("#btn-play-pause")).toHaveAttribute("aria-label", "Pause", {
    timeout: 5_000,
  });

  await page.waitForFunction(
    (initial) => {
      const label = document.querySelector("#time-label")?.textContent ?? "";
      return label !== initial && label.includes("UTC");
    },
    before,
    { timeout: 10_000 },
  );

  const afterFirst = (await page.locator("#time-label").textContent()) ?? "";
  expect(afterFirst).not.toBe(before);

  await page.waitForFunction(
    (previous) => {
      const label = document.querySelector("#time-label")?.textContent ?? "";
      return label !== previous;
    },
    afterFirst,
    { timeout: 10_000 },
  );

  const afterSecond = (await page.locator("#time-label").textContent()) ?? "";
  expect(afterSecond).not.toBe(afterFirst);
  await expect(page.locator("#btn-play-pause")).toHaveAttribute("aria-label", "Pause");
});
