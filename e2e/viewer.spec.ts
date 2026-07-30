import { expect, test } from "@playwright/test";
import {
  assertCanvasRendered,
  attachTestDiagnostics,
  createViewerMonitor,
  fixtureUrl,
  MINI_SOPHIA,
  MISSING_FIXTURE,
  waitForViewerReady,
} from "./helpers.js";

test.afterEach(async ({}, testInfo) => {
  const monitor = (testInfo as { _monitor?: ReturnType<typeof createViewerMonitor> })._monitor;
  if (monitor) attachTestDiagnostics(testInfo, monitor);
});

function monitorFor(testInfo: import("@playwright/test").TestInfo, page: import("@playwright/test").Page) {
  const monitor = createViewerMonitor(page);
  monitor.attach();
  (testInfo as { _monitor?: typeof monitor })._monitor = monitor;
  return monitor;
}

test("default page shows connect dialog and idle state", async ({ page }, testInfo) => {
  const monitor = monitorFor(testInfo, page);
  await page.goto("/");
  await expect(page.locator("#viewer-idle")).toBeVisible();
  await expect(page.locator("#viewer-idle")).toContainText("No dataset loaded");
  await expect(page.locator("#connect-dialog")).toBeVisible();
  await expect(page.locator("#connect-url")).toHaveValue("");
  monitor.assertClean();
});

test("url query param serves the app and renders canvas", async ({ page }, testInfo) => {
  const monitor = monitorFor(testInfo, page);
  const response = await page.goto(fixtureUrl(MINI_SOPHIA));
  expect(response?.status()).toBe(200);
  await expect(page.locator("body")).not.toContainText("403 Restricted");
  await expect(page.locator("#coastline-control")).toBeHidden();
  await assertCanvasRendered(page, monitor);
  await expect(page.locator("#dataset-url")).toContainText("mini-sophia.zarr");
  await expect(page.locator("#connect-dialog")).toBeHidden();
  monitor.assertClean();
});

test("path-only url is accepted in query param", async ({ page }, testInfo) => {
  const monitor = monitorFor(testInfo, page);
  await page.goto(fixtureUrl(MISSING_FIXTURE));
  await expect(page.locator("#dataset-url")).toContainText("missing-store.zarr");
  await expect(page.locator("#error-toast")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("#error-toast")).not.toContainText("Invalid URL");
  monitor.assertClean();
});

test("legacy query param migrates to hash in the address bar", async ({ page }, testInfo) => {
  const monitor = monitorFor(testInfo, page);
  await page.goto(fixtureUrl(MINI_SOPHIA, "variable=radiance"));
  await waitForViewerReady(page, monitor);
  await expect(page).toHaveURL(/^[^?]*#/);
  expect(new URL(page.url()).search).toBe("");
  await expect(page.locator("#variable-select")).toHaveValue("radiance");
});

test("shared url restores variable and datetime", async ({ page }, testInfo) => {
  const monitor = monitorFor(testInfo, page);
  await page.goto(
    fixtureUrl(
      MINI_SOPHIA,
      "variable=overexposure_mask&datetime=2024-06-16T12:00:00Z&rgb=0,2,3&autoscale=0",
    ),
  );
  await assertCanvasRendered(page, monitor);
  await expect(page.locator("#variable-select")).toHaveValue("overexposure_mask");
  await expect(page.locator("#rgb-bands")).toBeVisible();
  await expect(page.locator("#autoscale")).not.toBeChecked();
  await expect(page).toHaveURL(/^[^?]*#/);
});

test("manual scale min/max is persisted in hash url", async ({ page }, testInfo) => {
  const monitor = monitorFor(testInfo, page);
  await page.goto(fixtureUrl(MINI_SOPHIA));
  await waitForViewerReady(page, monitor);
  const hashBefore = await page.evaluate(() => window.location.hash);

  await page.locator("#autoscale").uncheck();
  await expect(page.locator("#scale-controls")).toBeVisible({ timeout: 5_000 });

  const minInput = page.locator('.scale-input[data-bound="min"]').first();
  const maxInput = page.locator('.scale-input[data-bound="max"]').first();
  await minInput.fill("100");
  await maxInput.fill("200");
  await maxInput.blur();

  await page.waitForFunction(
    (before) => window.location.hash.length > 1 && window.location.hash !== before,
    hashBefore,
    { timeout: 10_000 },
  );

  const shareUrl = await page.evaluate(() => window.location.pathname + window.location.hash);
  await page.goto(shareUrl);
  await waitForViewerReady(page, monitor);

  await expect(page.locator("#autoscale")).not.toBeChecked();
  await expect(minInput).toHaveValue("100");
  await expect(maxInput).toHaveValue("200");
});

test("full tab mode hides sidebars", async ({ page }, testInfo) => {
  const monitor = monitorFor(testInfo, page);
  await page.goto(fixtureUrl(MINI_SOPHIA));
  await waitForViewerReady(page, monitor);
  await page.locator("#btn-layout").click();
  await expect(page.locator("#body-grid")).toHaveClass(/full-tab/);
});
