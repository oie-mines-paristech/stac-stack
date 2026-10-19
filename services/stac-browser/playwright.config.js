import { defineConfig, devices } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';

// This host (LMDE/Linux Mint) isn't supported by `npx playwright install`, which
// fails with "Playwright does not support chromium on …". Fall back to the
// system Chromium so local runs never trigger a browser download; CI and the
// Docker image don't ship one at these paths and keep Playwright's own build.
// Set PLAYWRIGHT_CHROMIUM_PATH to point somewhere else explicitly.
function resolveChromiumExecutable() {
  if (process.env.PLAYWRIGHT_CHROMIUM_PATH) {
    return process.env.PLAYWRIGHT_CHROMIUM_PATH;
  }
  return ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium']
    .find(candidate => fs.existsSync(candidate)) || null;
}

export const chromiumExecutablePath = resolveChromiumExecutable();

function getEnvWithoutSB() {
  const env = {};
  for (const key in process.env) {
    if (!key.startsWith('SB_')) {
      env[key] = process.env[key];
    }
  }
  return env;
}

// The specs serve their mock catalogs through the /external/... routes, which
// only exist when external access is on, and would otherwise be rewritten
// against config.js's fixed CDSE catalog URL.
const E2E_CONFIG = {
  SB_allowExternalAccess: 'true',
  SB_catalogUrl: ''
};

/**
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './tests/e2e',

  /* Warm up the (dev) server before the workers start, see global-setup.js */
  globalSetup: './tests/e2e/global-setup.js',

  /* Run tests in files in parallel */
  fullyParallel: true,
  
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,

  retries: 1,

  /* Default assertion timeout. Raised from Playwright's 5s default because the
     dev server transforms modules on demand and, with many parallel workers,
     async renders/navigations routinely need longer locally. */
  expect: { timeout: 10000 },

  /* CI serves a static production build (no on-demand transforms), so it runs
     single-worker. Locally the dev server transforms modules on demand from a
     single process, so it — not the CPU count — is the bottleneck: the default
     (50% of cores) overwhelms it on many-core machines and makes lazy-chunk
     loads flaky. Use half the cores (like Playwright's default) but cap at 6 so
     a big machine doesn't swamp the dev server, while smaller/slower CPUs still
     scale down and aren't oversubscribed. */
  workers: process.env.CI ? 1 : Math.min(6, Math.max(1, Math.ceil(os.cpus().length / 2))),
  
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: [
    ['html'],
    ['list']
  ],
  
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: process.env.CI 
      ? 'http://localhost:4173'  // Vite preview server port
      : 'http://localhost:8080',
    
    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',

    /* Clipboard permissions for copy-related tests */
    permissions: ['clipboard-read', 'clipboard-write'],
    
    /* Screenshot on failure */
    screenshot: 'only-on-failure',
    
    /* Video on failure — only when Playwright owns the browser: the system
       Chromium fallback sits on a host where `npx playwright install` (which
       would also fetch the ffmpeg binary video needs) is unsupported. */
    video: chromiumExecutablePath ? 'off' : 'retain-on-failure',

    /* Force English locale so tests are deterministic regardless of host/CI locale.
       The app auto-detects language from navigator.languages when detectLocaleFromBrowser is true. */
    locale: 'en',

    permissions: ['clipboard-read', 'clipboard-write'],

    ...(chromiumExecutablePath ? { launchOptions: { executablePath: chromiumExecutablePath } } : {}),
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },

    // Uncomment to test on Firefox and WebKit
    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'] },
    // },
    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] },
    // },

    /* Test against mobile viewports. */
    // {
    //   name: 'Mobile Chrome',
    //   use: { ...devices['Pixel 5'] },
    // },
  ],

  /* Run your local dev server before starting the tests */
  webServer: process.env.CI
    ? {
        // In CI: Build and serve the production build.
        // STAC_BROWSER_E2E enables __VUE_PROD_DEVTOOLS__ so tests can introspect
        // the map (see vite.config.js); it does not affect real production builds.
        command: 'npm run build && npx vite preview --port 4173 --strictPort',
        env: { ...getEnvWithoutSB(), ...E2E_CONFIG, STAC_BROWSER_E2E: 'true' },
        url: 'http://localhost:4173',
        reuseExistingServer: false,
        timeout: 120 * 1000,
      }
    : {
        command: 'npm start',
        env: { ...process.env, ...E2E_CONFIG, STAC_BROWSER_E2E: 'true' },
        url: 'http://localhost:8080',
        reuseExistingServer: true,
        timeout: 120 * 1000,
      },
});
