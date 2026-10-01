import { chromium } from '@playwright/test';
import StaticCatalog from '../fixtures/instances/static';

/**
 * Warms up the web server before the test workers start.
 *
 * The dev server (vite) transforms the application modules on first request.
 * Without a warm-up, all parallel workers hit the cold server at once and the
 * first batch of tests may time out while the server is still transforming.
 */
export default async function globalSetup(config) {
  const { baseURL, launchOptions } = config.projects[0].use;
  // launchOptions carries the system-Chromium executablePath resolved in
  // playwright.config.js — without it the launch fails on hosts where
  // `npx playwright install` is unsupported.
  const browser = await chromium.launch(launchOptions || {});
  try {
    const url = 'stac.example/catalog.json';
    const catalog = new StaticCatalog({ url: `https://${url}` });
    await catalog.createServer();
    const page = await browser.newPage();
    await page.goto(baseURL, { waitUntil: 'networkidle', timeout: 60 * 1000 });
    await page.goto(`${baseURL}/external/${url}`, { waitUntil: 'networkidle', timeout: 60 * 1000 });
  } catch (error) {
    // The warm-up is best-effort, never fail the test run
    console.warn('Web server warm-up failed:', error.message);
  } finally {
    await browser.close();
  }
}
