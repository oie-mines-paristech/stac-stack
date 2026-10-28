/**
 * Grouped variable names in the metadata tables.
 *
 * Variables of a Zarr store can live in subgroups ("qc/observation_missing").
 * In the `cube:variables` and asset `bands` tables, root variables come first,
 * grouped ones sit indented under a collapsed group header (without their
 * "group/" prefix), and a long description is clamped behind an expand button.
 */
import { test, expect } from './fixtures.js';
import { waitForBrowserReady } from './helpers.js';
import StaticCatalog from '../fixtures/instances/static.js';

const ROOT_URL = 'https://stac.example/catalog.json';
const ITEM_URL = 'https://stac.example/item.json';
const LONG_COMMENT = 'x'.repeat(200);
const MISSING_DESCRIPTION = `missing observation flag.\n\n${LONG_COMMENT}`;

function createItem(catalog) {
  const item = catalog.addItem({ url: ITEM_URL });
  item.setMetadata({
    title: 'Grouped variables item',
    datetime: '2025-01-01T00:00:00Z',
    'cube:dimensions': {
      time: { type: 'temporal', extent: ['2025-01-01T00:00:00Z', '2025-01-02T00:00:00Z'] }
    },
    'cube:variables': {
      radiance: { type: 'data', dimensions: ['time'], unit: 'W/m2/sr', description: 'sky radiance' },
      'qc/observation_missing': { type: 'data', dimensions: ['time'], description: MISSING_DESCRIPTION }
    }
  });
  item.data.stac_extensions = [
    'https://stac-extensions.github.io/datacube/v2.2.0/schema.json'
  ];
  item.data.assets = {
    data: {
      href: 'https://stac.example/data.zarr',
      type: 'application/vnd.zarr; version=3',
      title: 'Zarr store',
      roles: ['data'],
      bands: [
        { name: 'radiance', description: 'sky radiance' },
        { name: 'qc/observation_missing', description: MISSING_DESCRIPTION }
      ]
    }
  };
  return item;
}

async function setup(page, worker) {
  const catalog = new StaticCatalog({ url: ROOT_URL });
  const item = createItem(catalog);
  await catalog.createServer(worker);
  await page.goto(item.getBrowserPath());
  await waitForBrowserReady(page);
  return item;
}

/** The Data Cube card holds one table: the variables (dimensions stay a list).
 *  b-table puts the class on the responsive wrapper, hence `.metadata-table`. */
function variablesTable(page) {
  return page.locator('.metadata-card', { hasText: 'Data Cube' }).locator('.metadata-table');
}

test.describe('Grouped variables', () => {
  test('cube:variables groups are collapsed and root variables come first', async ({ page, worker }) => {
    await setup(page, worker);
    const table = variablesTable(page);

    await expect(table.locator('tbody tr').first()).toContainText('radiance');
    await expect(table).not.toContainText('observation_missing');

    const toggle = table.locator('.group-toggle');
    await expect(toggle).toContainText('qc');
    await expect(toggle).toContainText('(1)');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await toggle.click();
    await expect(table).toContainText('observation_missing');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');

    await toggle.click();
    await expect(table).not.toContainText('observation_missing');
  });

  test('cube:variables descriptions are clamped and can be expanded', async ({ page, worker }) => {
    await setup(page, worker);
    const table = variablesTable(page);
    await table.locator('.group-toggle').click();

    const row = table.locator('tbody tr', { hasText: 'observation_missing' });
    await expect(row.locator('.clamped-text-value')).toContainText('missing observation flag.');
    await row.getByRole('button', { name: /read more/i }).click();
    await expect(row.getByRole('button', { name: /read less/i })).toBeVisible();
  });

  test('asset bands groups are collapsed and clamped too', async ({ page, worker }) => {
    await setup(page, worker);
    const asset = page.locator('.asset', { hasText: 'Zarr store' });
    const header = asset.getByRole('button', { name: /Zarr store/ });
    await expect(header).toBeVisible();
    // The asset box may start collapsed; open it (never toggle it back shut).
    if ((await header.getAttribute('aria-expanded')) === 'false') {
      await header.click();
    }
    const table = asset.locator('.metadata-table');
    await expect(table).toBeVisible({ timeout: 15000 });

    await expect(table).toContainText('radiance');
    await expect(table).not.toContainText('observation_missing');

    await table.locator('.group-toggle').click();
    const row = table.locator('tbody tr', { hasText: 'observation_missing' });
    await expect(row.locator('.clamped-text-value')).toContainText('missing observation flag.');
    await row.getByRole('button', { name: /read more/i }).click();
    await expect(row.getByRole('button', { name: /read less/i })).toBeVisible();
  });
});
