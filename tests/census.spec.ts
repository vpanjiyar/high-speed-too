import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:5174';

/** Wait for the MapLibre map to fully load its style and data. */
async function waitForMapLoad(page: import('@playwright/test').Page) {
  await page.waitForFunction(() => (window as unknown as Record<string, unknown>)['__mapState'] === 'loaded', { timeout: 20_000 });
}

async function waitForCensusLayer(page: import('@playwright/test').Page, layerId = 'census-msoa-fill') {
  await page.waitForFunction((targetLayerId) => {
    const map = (window as unknown as { __map?: {
      getLayer: (id: string) => unknown;
      getLayoutProperty: (id: string, name: string) => unknown;
    } }).__map;
    if (!map?.getLayer(targetLayerId)) return false;
    return map.getLayoutProperty(targetLayerId, 'visibility') === 'visible';
  }, layerId, { timeout: 30_000 });
}

test('map page loads', async ({ page }) => {
  await page.goto(BASE);
  await expect(page.locator('#map canvas')).toBeVisible({ timeout: 15_000 });
});

test('census panel has all metric radio options', async ({ page }) => {
  await page.goto(BASE);
  const radios = page.locator('input[name="census-metric"]');
  // off + 5 demographics + 4 transport + 2 economic + 1 accessibility = 13
  await expect(radios).toHaveCount(13);
});

test('selecting Population radio shows loading then legend', async ({ page }) => {
  await page.goto(BASE);
  await waitForMapLoad(page);

  await page.locator('#overlays-panel label').filter({ hasText: 'Population' }).click();
  await waitForCensusLayer(page);

  const legend = page.locator('#census-legend');
  await expect(legend).toBeVisible({ timeout: 30_000 });
  await expect(legend).not.toHaveCSS('display', 'none');
  await expect(page.locator('#census-error')).toBeHidden();
});

test('census boundary data files are non-empty', async ({ page }) => {
  // LSOA file
  const lsoaRes = await page.request.get(`${BASE}/data/lsoa_boundaries.geojson`);
  expect(lsoaRes.ok()).toBe(true);
  const lsoaJson = await lsoaRes.json();
  expect(lsoaJson.features.length).toBeGreaterThan(30_000);

  // MSOA file
  const msoaRes = await page.request.get(`${BASE}/data/msoa_boundaries.geojson`);
  expect(msoaRes.ok()).toBe(true);
  const msoaJson = await msoaRes.json();
  expect(msoaJson.features.length).toBeGreaterThan(5_000);
});

test('each LSOA feature has pop and work_pop properties', async ({ page }) => {
  const res = await page.request.get(`${BASE}/data/lsoa_boundaries.geojson`);
  const json = await res.json();
  // Check first 10 features for the required properties
  const sample = json.features.slice(0, 10);
  for (const f of sample) {
    expect(typeof f.properties.pop).toBe('number');
    expect(typeof f.properties.work_pop).toBe('number');
    expect(f.properties.pop).toBeGreaterThan(0);
  }
});

test('each MSOA feature has pop and work_pop properties', async ({ page }) => {
  const res = await page.request.get(`${BASE}/data/msoa_boundaries.geojson`);
  const json = await res.json();
  const sample = json.features.slice(0, 10);
  for (const f of sample) {
    expect(typeof f.properties.pop).toBe('number');
    expect(typeof f.properties.work_pop).toBe('number');
    expect(f.properties.pop).toBeGreaterThan(0);
  }
});

test('switching from Population to Density keeps overlay visible', async ({ page }) => {
  await page.goto(BASE);
  await waitForMapLoad(page);

  await page.locator('#overlays-panel label').filter({ hasText: 'Population' }).click();
  await waitForCensusLayer(page);
  await expect(page.locator('#census-legend')).toBeVisible({ timeout: 30_000 });

  await page.locator('#overlays-panel label').filter({ hasText: 'Density' }).click();
  await waitForCensusLayer(page);

  await expect(page.locator('#census-legend')).toBeVisible();
  await expect(page.locator('#census-error')).toBeHidden();
});

test('switching to Off hides legend', async ({ page }) => {
  await page.goto(BASE);
  await waitForMapLoad(page);

  await page.locator('#overlays-panel label').filter({ hasText: 'Population' }).click();
  await waitForCensusLayer(page);
  await expect(page.locator('#census-legend')).toBeVisible({ timeout: 30_000 });

  await page.locator('#overlays-panel label').filter({ hasText: 'Off' }).click();
  await expect(page.locator('#census-legend')).toBeHidden();
});

test('selecting no-car overlay activates census layer', async ({ page }) => {
  await page.goto(BASE);
  await waitForMapLoad(page);

  await page.locator('#overlays-panel label').filter({ hasText: 'No Car/Van %' }).click();
  await waitForCensusLayer(page);

  await expect(page.locator('#census-legend')).toBeVisible();
  await expect(page.locator('#census-error')).toBeHidden();
});

