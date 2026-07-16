import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  expect: { timeout: 90_000 },
  use: {
    headless: true,
  },
  webServer: {
    command: "npm run dev",
    port: 5173,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
