import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 45_000,
  expect: { timeout: 8_000 },
  workers: 1,
  use: {
    headless: true,
  },
  webServer: {
    command:
      "npm run build:e2e-fixture && npm run build && npm run preview -- --port 5173 --strictPort",
    port: 5173,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
