import { expect, test } from "@playwright/test";

const SOPHIA =
  "https://demos.oie-lab.net/stac/data/fisheye/sophia.zarr/";

async function waitForFrameReady(page: import("@playwright/test").Page): Promise<void> {
  await page.waitForSelector("#canvas", { state: "attached" });
  await page.waitForFunction(() => {
    const status = document.querySelector("#status")?.textContent ?? "";
    return (
      !status.includes("Loading") &&
      !status.includes("Opening") &&
      !status.startsWith("Error:")
    );
  }, { timeout: 90_000 });
}

async function assertCanvasRendered(
  page: import("@playwright/test").Page,
): Promise<void> {
  await waitForFrameReady(page);
  await expect(page.locator("#status")).not.toContainText("Error:");

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

test("default page renders a non-empty canvas", async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto("/");
  await assertCanvasRendered(page);
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

test("shared url restores variable and datetime", async ({ page }) => {
  const target =
    `/?url=${encodeURIComponent(SOPHIA)}` +
    "&variable=overexposure_mask&datetime=2024-06-16T12:00:00Z&rgb=0,2,3&autoscale=0";
  await page.goto(target);
  await assertCanvasRendered(page);
  await expect(page.locator("#variable-select")).toHaveValue("overexposure_mask");
  await expect(page.locator("#rgb-bands")).toBeVisible();
  await expect(page.locator("#autoscale")).not.toBeChecked();
  await expect(page).toHaveURL(/variable=overexposure_mask/);
  await expect(page).toHaveURL(/datetime=2024-06-16T12%3A00%3A00Z/);
});
