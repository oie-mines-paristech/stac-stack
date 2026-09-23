import base from '/home/rjolivet/stac-oie/services/stac-browser/playwright.config.js';
import { devices } from '@playwright/test';

export default {
  ...base,
  globalSetup: undefined,
  workers: 1,
  reporter: [['list']],
  use: {
    ...base.use,
    trace: 'off',
    video: 'off',
    screenshot: 'off',
    launchOptions: { executablePath: '/usr/bin/chromium' },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], launchOptions: { executablePath: '/usr/bin/chromium' } } },
  ],
  webServer: {
    command: 'npm start',
    env: { ...process.env, STAC_BROWSER_E2E: 'true' },
    url: 'http://localhost:8080',
    reuseExistingServer: true,
    timeout: 120 * 1000,
  },
};