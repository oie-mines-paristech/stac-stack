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

async function readTimeLabel(page: import("@playwright/test").Page): Promise<string> {
  return page.locator("#time-label").textContent().then((text) => text ?? "");
}

test("play advances multiple frames", async ({ page }) => {
  await page.goto(`/?url=${encodeURIComponent(SOPHIA)}&variable=radiance`);
  await waitForFrameReady(page);

  const before = await readTimeLabel(page);
  await page.locator("#btn-play-pause").click();
  await expect(page.locator("#btn-play-pause")).toHaveAttribute("aria-label", "Pause");

  await page.waitForFunction(
    (initial) => {
      const label = document.querySelector("#time-label")?.textContent ?? "";
      return label !== initial;
    },
    before,
    { timeout: 15_000 },
  );

  const afterFirst = await readTimeLabel(page);
  expect(afterFirst).not.toBe(before);

  await page.waitForTimeout(3000);
  const afterWait = await readTimeLabel(page);
  console.log("before:", before);
  console.log("afterFirst:", afterFirst);
  console.log("afterWait:", afterWait);
  console.log("playing:", await page.locator("#btn-play-pause").getAttribute("aria-label"));

  expect(afterWait).not.toBe(afterFirst);
  await expect(page.locator("#btn-play-pause")).toHaveAttribute("aria-label", "Pause");
});
