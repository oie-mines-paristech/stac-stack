/**
 * Item properties, geometry & assets tests.
 *
 * Exercises viewing an item in a STAC catalog.
 * Verifies metadata rendering, geometry display, asset listing, and breadcrumb navigation.
 */
import { test, expect } from './fixtures.js';
import { waitForBrowserReady } from './helpers.js';
import StaticCatalog from '../fixtures/instances/static.js';
import API from '../fixtures/instances/api.js';
import { http, HttpResponse } from 'msw';

test.describe('Item view - Metadata', () => {
  function createCatalog() {
    const catalog = new StaticCatalog({ url: 'https://stac.example/catalog.json' });
    const collection = catalog.addCollection({ url: 'https://stac.example/collection.json' });
    
    const item = collection.addItem({ url: 'https://stac.example/item.json' })
      .setMetadata({ title: 'Test Item 2025-001', datetime: '2025-01-01T00:00:00Z' });
    return { catalog, collection, item };
  }

  function createAPI() {
    const api = API.minimalApi();
    const collection = api.addCollection('collection')
      .setMetadata({ title: "Example EO Collection", description: "An example STAC Collection with EO extension." });
    const items = api.addManyItems(collection, 3);
    return { api, collection, items };
  }

  test('Catalog - should display item metadata', async ({ page, worker }) => {
    const { catalog, collection, item } = createCatalog(); 
    await catalog.createServer(worker);
    
    await page.goto(catalog.root.getBrowserPath());
    await waitForBrowserReady(page);
    
    await page.getByRole('link', { name: new RegExp(collection.getMetadata().title, 'i') }).click();
    await waitForBrowserReady(page);
    
    const collectionTitle = await page.getByRole('heading', { name: new RegExp(collection.getMetadata().title, 'i') });
    await expect(collectionTitle).toBeVisible();
    
    await page.getByRole('link', { name: new RegExp(item.getMetadata().title, 'i') }).click();
    await waitForBrowserReady(page);
    
    const itemTitle = await page.getByRole('heading', { name: new RegExp(item.getMetadata().title, 'i') });
    await expect(itemTitle).toBeVisible();
  });

  test('should display rich item properties from EO collection', async ({ page, worker }) => {
    const { api, items } = createAPI();
    await api.createServer(worker);
    
    const item = items[0];
    await page.goto(item.getBrowserPath());
    await waitForBrowserReady(page);
    
    // check heading shows item id
    await expect(page.getByRole('heading', { name: new RegExp(item.data.id, 'i') })).toBeVisible();
    
    await expect(page.getByText(/cloud cover/i)).toBeVisible();
    await expect(page.getByText(/constellation/i)).toBeVisible();
    await expect(page.getByText(/time of data begins/i)).toBeVisible();
    
    //expand and view metadata
    await page.getByRole('button', { name: /metadata/i }).click();
    await expect(page.getByRole('button', { name: /download/i })).toBeVisible();
    
    //expand and view measurements
    await page.getByRole('button', { name: /measurements/i }).click();
    // bands are listed
    await expect(page.locator('.row:has-text("Bands")').getByText(/B1/i)).toBeVisible();
    await expect(page.locator('.row:has-text("Bands")').getByText(/B2/i)).toBeVisible();
    await expect(page.locator('.row:has-text("Bands")').getByText(/B3/i)).toBeVisible();
  });

  test('API - should display item metadata', async ({ page, worker }) => {
    const { api, items } = createAPI();
    await api.createServer(worker);
    
    const item = items[0];
    await page.goto(item.getBrowserPath());
    await waitForBrowserReady(page);
    
    // check heading shows item id
    await expect(page.getByRole('heading', { name: new RegExp(item.data.id, 'i') })).toBeVisible();
    
    await expect(page.getByText(/cloud cover/i)).toBeVisible();
    await expect(page.getByText(/constellation/i)).toBeVisible();
    await expect(page.getByText(/time of data begins/i)).toBeVisible();
    
    //expand and view metadata
    await page.getByRole('button', { name: /metadata/i }).click();
    await expect(page.getByRole('button', { name: /download/i })).toBeVisible();
    
    //expand and view measurements
    await page.getByRole('button', { name: /measurements/i }).click();
    // bands are listed
    await expect(page.locator('.row:has-text("Bands")').getByText(/B1/i)).toBeVisible();
    await expect(page.locator('.row:has-text("Bands")').getByText(/B2/i)).toBeVisible();
    await expect(page.locator('.row:has-text("Bands")').getByText(/B3/i)).toBeVisible();
  });

  test('map & thumbnails behave correctly', async ({ page, worker }) => {
    const { api, items } = createAPI();
    await api.createServer(worker);
    const item = items[0];
    await page.goto(item.getBrowserPath());
    await waitForBrowserReady(page);
    
    await expect(page.locator('.maps-preview')).toBeVisible();
    const thumbTab = page.getByRole('tab', { name: /thumbnails/i });
    await thumbTab.click();
    await expect(page.getByRole('tabpanel', { name: /thumbnails/i })).toBeVisible();
    const mapTab = page.getByRole('tab', { name: /map/i });
    await mapTab.click();
    const zoomIn = page.locator('.maps-preview button', { hasText: '+' }).first();
    const zoomOut = page.locator('.maps-preview button').filter({ hasText: /[-\u2013\u2212]/ }).first();
    const fullscreen = page.locator('.maps-preview button', { hasText: /\u26F6|fullscreen/i }).first();
    await expect(zoomIn).toBeEnabled();
    await expect(zoomOut).toHaveCount(1);
    await expect(fullscreen).toBeEnabled();
  });

  test('additional resources links are shown', async ({ page, worker }) => {
    const { api, items } = createAPI();
    await api.createServer(worker);
    const item = items[0];
    await page.goto(item.getBrowserPath());
    await waitForBrowserReady(page);
    
    // The item has "via" and "describedby" links which appear under
    // "Additional Resources" (or similar heading) on the item view.
    await expect(page.getByRole('heading', { name: /additional resources/i })).toBeVisible();
  });
});

test.describe('Item view - Assets', () => {
  function createCatalog() {
    const catalog = new StaticCatalog({url: 'https://stac.example/catalog.json'});
    const collection = catalog.addCollection({ url: 'https://stac.example/collection.json' });
    const item = collection.addItem({ url: 'https://stac.example/item.json' });
    return { catalog, collection, item };
  }

  function createAPI() {
    const api = API.minimalApi();
    const collection = api.addCollection('collection', {})
      .setMetadata({ title: "Example EO Collection", description: "An example STAC Collection with EO extension." });
    const items = api.addManyItems(collection, 3);
    const item = items[0];
    return { api, collection, item };
  }

  // Catalog tests
  test('Catalog - should list item assets', async ({ page, worker }) => {
    const { catalog, item } = createCatalog();
    await catalog.createServer(worker);
    
    await page.goto(item.getBrowserPath());
    await waitForBrowserReady(page);
    
    await expect(page.locator('.assets')).toBeVisible();
  });
  
  test('Catalog - renders asset with title and href', async ({ page, worker }) => {    
    const { catalog, item } = createCatalog();
    await catalog.createServer(worker);
    
    await page.goto(item.getBrowserPath());
    await waitForBrowserReady(page);
    // target the data-asset for this test
    const asset = item.data.assets.data;
    
    const assetBtn = page.getByRole('button', { name: new RegExp(asset.title, 'i') }).first();
    
    await expect(assetBtn).toBeVisible();
    await assetBtn.click();
    await waitForBrowserReady(page);
    
    // the expanded asset panel shows Download / Copy URL / Show on map buttons
    await expect(page.getByRole('button', { name: /download/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /show on map/i })).toBeVisible();
  });

  // Image assets are previewed inline as soon as their box is expanded.
  // The fixture thumbnail is pulled out of the assets list into the preview
  // pane, so this uses a plain image asset with a custom role instead.
  test('Catalog - shows image assets inline when expanded', async ({ page, worker }) => {
    // Cold vite transforms under parallel workers push this past the 30s default.
    test.slow();
    const { catalog, item } = createCatalog();
    const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const QC_URL = 'https://stac.example/qc.png';
    item.data.assets = {
      qc: { href: QC_URL, type: 'image/png', roles: ['qc'], title: 'Quality control plot' }
    };
    await catalog.createServer(worker);
    await worker.use(
      http.get(QC_URL, () => {
        const bytes = Uint8Array.from(atob(PNG_BASE64), c => c.charCodeAt(0));
        return new HttpResponse(bytes, { headers: { 'Content-Type': 'image/png' } });
      })
    );

    await page.goto(item.getBrowserPath());
    await waitForBrowserReady(page);

    const assetBtn = page.getByRole('button', { name: /Quality control plot/i }).first();

    await expect(assetBtn).toBeVisible();
    await assetBtn.click();

    const preview = page.locator('.assets .asset-alternative img').first();
    await preview.scrollIntoViewIfNeeded();
    await expect(preview).toBeVisible();
    await expect(preview).toHaveAttribute('src', QC_URL);
  });

  // API tests
  test('API - should list item assets', async ({ page, worker }) => {
    const { api, item } = createAPI();
    await api.createServer(worker);
    
    await page.goto(item.getBrowserPath());
    await waitForBrowserReady(page);
    
    await expect(page.locator('.assets')).toBeVisible();
  });
  
  test('API - renders asset with title and href', async ({ page, worker }) => {    
    const { api, item } = createAPI();
    await api.createServer(worker);
    
    await page.goto(item.getBrowserPath());
    await waitForBrowserReady(page);
    // ignore the first asset which is a thumbnail.
    const assetKey = Object.keys(item.data.assets)[1];
    const asset = item.data.assets[assetKey];
    
    const assetBtn = page.getByRole('button', { name: new RegExp(asset.title, 'i') }).first();
    
    await expect(assetBtn).toBeVisible();
    await assetBtn.click();
    await waitForBrowserReady(page);
    
    // the expanded asset panel shows Download / Copy URL / Show on map buttons
    await expect(page.getByRole('button', { name: /download/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /show on map/i })).toBeVisible();
  });
});

test.describe('Item view - Alternate thumbnails', () => {
  // A minimal 1x1 PNG, served for the HTTPS alternate of an S3-only thumbnail.
  const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const THUMB_URL = 'https://stac.example/thumbnail-https.png';

  function createCatalog() {
    const catalog = new StaticCatalog({ url: 'https://stac.example/catalog.json' });
    catalog.addCollection({ url: 'https://stac.example/collection.json' });
    const item = catalog.addItem({ url: 'https://stac.example/item.json' });
    // The thumbnail's main access mechanism is S3 (which a browser can't display),
    // but it provides an HTTPS alternate that a browser *can* display. STAC Browser
    // should fall back to the alternate. See
    // https://github.com/radiantearth/stac-browser/issues/910
    item.data.assets = {
      thumbnail: {
        href: 's3://example-bucket/thumbnail.png',
        type: 'image/png',
        roles: ['thumbnail'],
        title: 'Thumbnail Image',
        'alternate:name': 'S3',
        alternate: {
          https: {
            href: THUMB_URL,
            type: 'image/png',
            'alternate:name': 'HTTPS'
          }
        }
      }
    };
    item.addToExtensions('https://stac-extensions.github.io/alternate-assets/v1.2.0/schema.json');
    return { catalog, item };
  }

  test('falls back to the HTTPS alternate and actually renders the image', async ({ page, worker }) => {
    const { catalog, item } = createCatalog();
    await catalog.createServer(worker);
    // Serve an actual image for the HTTPS alternate (added after createServer,
    // which resets handlers).
    await worker.use(
      http.get(THUMB_URL, () => {
        const bytes = Uint8Array.from(atob(PNG_BASE64), c => c.charCodeAt(0));
        return new HttpResponse(bytes, { headers: { 'Content-Type': 'image/png' } });
      })
    );

    await page.goto(item.getBrowserPath());
    await waitForBrowserReady(page);

    // Open the thumbnails tab.
    const thumbTab = page.getByRole('tab', { name: /thumbnails/i });
    await thumbTab.click();
    await expect(page.getByRole('tabpanel', { name: /thumbnails/i })).toBeVisible();

    // The rendered thumbnail must use the HTTPS alternate URL, not the S3 href.
    const img = page.locator('img.thumbnail');
    await expect(img).toBeVisible();
    await expect(img).toHaveAttribute('src', THUMB_URL);

    // And the image must have actually loaded (decoded to a non-zero size).
    await expect
      .poll(() => img.evaluate(el => el.complete && el.naturalWidth > 0))
      .toBe(true);
  });
});

test.describe('Item view - Geometry', () => {
  function createCatalog() {
    const catalog = new StaticCatalog({url: 'https://stac.example/catalog.json'});
    const collection = catalog.addCollection({ url: 'https://stac.example/collection.json' });
    const item = collection.addItem({ url: 'https://stac.example/item.json' });
    return { catalog, collection, item };
  }

  function createAPI() {
    const api = API.minimalApi();
    const collection = api.addCollection('collection', {});
    const items = api.addManyItems(collection, 3);
    const item = items[0];
    return { api, collection, item };
  }

  // Catalog tests
  test('Catalog - renders a map with item geometry', async ({ page, worker }) => {
    const { catalog, item } = createCatalog();
    await catalog.createServer(worker);
    
    await page.goto(item.getBrowserPath());
    await waitForBrowserReady(page);
    
    await expect(page.locator('.map')).toBeVisible();
  });
  
  test('Catalog - map & thumbnails behave correctly', async ({ page, worker }) => {
    const { catalog, item } = createCatalog();
    await catalog.createServer(worker);
    
    await page.goto(item.getBrowserPath());
    await waitForBrowserReady(page);
    
    await expect(page.locator('.maps-preview')).toBeVisible();
    
    const thumbTab = page.getByRole('tab', { name: /thumbnails/i });
    await thumbTab.click();
    await waitForBrowserReady(page);
    
    await expect(page.getByRole('tabpanel', { name: /thumbnails/i })).toBeVisible();
    
    const mapTab = page.getByRole('tab', { name: /map/i });
    await mapTab.click();
    await waitForBrowserReady(page);
    
    const zoomIn = page.locator('.maps-preview button', { hasText: '+' }).first();
    const zoomOut = page.locator('.maps-preview button').filter({ hasText: /[-\u2013\u2212]/ }).first();
    const fullscreen = page.locator('.maps-preview button', { hasText: /\u26F6|fullscreen/i }).first();
    await expect(zoomIn).toBeEnabled();
    await expect(zoomOut).toHaveCount(1);
    await expect(fullscreen).toBeEnabled();
  });

  // API tests
  test('API - renders a map with item geometry', async ({ page, worker }) => {
    const { api, item } = createAPI();
    await api.createServer(worker);
    
    await page.goto(item.getBrowserPath());
    await waitForBrowserReady(page);
    
    await expect(page.locator('.map')).toBeVisible();
  });
  
  test('API - map & thumbnails behave correctly', async ({ page, worker }) => {
    const { api, item } = createAPI();
    await api.createServer(worker);
    
    await page.goto(item.getBrowserPath());
    await waitForBrowserReady(page);
    
    await expect(page.locator('.maps-preview')).toBeVisible();
    
    const thumbTab = page.getByRole('tab', { name: /thumbnails/i });
    await thumbTab.click();
    await waitForBrowserReady(page);
    
    await expect(page.getByRole('tabpanel', { name: /thumbnails/i })).toBeVisible();
    
    const mapTab = page.getByRole('tab', { name: /map/i });
    await mapTab.click();
    await waitForBrowserReady(page);
    
    const zoomIn = page.locator('.maps-preview button', { hasText: '+' }).first();
    const zoomOut = page.locator('.maps-preview button').filter({ hasText: /[-\u2013\u2212]/ }).first();
    const fullscreen = page.locator('.maps-preview button', { hasText: /\u26F6|fullscreen/i }).first();
    await expect(zoomIn).toBeEnabled();
    await expect(zoomOut).toHaveCount(1);
    await expect(fullscreen).toBeEnabled();
  });
});

test.describe('Item view - OPeNDAP assets', () => {
  test('OPeNDAP asset offers copy URL but no download', async ({ page, worker }) => {
    const catalog = new StaticCatalog({ url: 'https://stac.example/catalog.json' });
    const collection = catalog.addCollection({ url: 'https://stac.example/collection.json' });
    const item = collection.addItem({ url: 'https://stac.example/item.json' })
      .setMetadata({ title: 'OPeNDAP station 2025', datetime: '2025-01-01T00:00:00Z' });

    item.data.assets = {
      data: {
        href: 'https://tds.example.org/thredds/fileServer/station.nc',
        type: 'application/x-netcdf',
        roles: ['data'],
        title: 'NetCDF Data'
      },
      'data-opendap': {
        href: 'https://tds.example.org/thredds/dodsC/station.nc',
        roles: ['data'],
        title: 'OPeNDAP access',
        description: 'This is an OPeNDAP URL. It should be used by a NetCDF client and cannot be downloaded.',
        'browser:downloadable': false
      },
      'data-opendap-form': {
        href: 'https://tds.example.org/thredds/dodsC/station.nc.html',
        type: 'text/html',
        roles: ['documentation'],
        title: 'OPeNDAP Dataset Access Form'
      }
    };

    await catalog.createServer(worker);
    await page.goto(catalog.root.getBrowserPath());
    await waitForBrowserReady(page);

    await page.getByRole('link', { name: new RegExp(collection.getMetadata().title, 'i') }).click();
    await waitForBrowserReady(page);

    await page.getByRole('link', { name: /OPeNDAP station 2025/i }).click();
    await waitForBrowserReady(page);

    const opendapBlock = page.locator('#asset-data-opendap');
    await opendapBlock.getByRole('button', { name: /OPeNDAP access/i }).click();
    await expect(opendapBlock.getByRole('button', { name: /copy url/i })).toBeVisible();
    await expect(opendapBlock.getByRole('button', { name: /download/i })).toHaveCount(0);
    await expect(opendapBlock.getByText(/cannot be downloaded/i)).toBeVisible();

    const formBlock = page.locator('#asset-data-opendap-form');
    await formBlock.getByRole('button', { name: /OPeNDAP Dataset Access Form/i }).click();
    await expect(formBlock.getByRole('button', { name: /open/i })).toBeVisible();
    await expect(formBlock.getByRole('button', { name: /download/i })).toHaveCount(0);
  });
});
