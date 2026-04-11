import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:5174';

/** Wait for the MapLibre map to fully load its style and data. */
async function waitForMapLoad(page: import('@playwright/test').Page) {
  await page.waitForFunction(() => (window as unknown as Record<string, unknown>)['__mapState'] === 'loaded', { timeout: 20_000 });
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

  // Click the label wrapping the Population radio (input is visually hidden)
  await page.locator('#overlays-panel label').filter({ hasText: 'Population' }).click();

  // Legend shows as soon as setMetric is called (even during loading)
  const legend = page.locator('#census-legend');
  await expect(legend).toBeVisible({ timeout: 30_000 });
  await expect(legend).not.toHaveCSS('display', 'none');
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

  // Enable population overlay and wait for legend to appear
  await page.locator('#overlays-panel label').filter({ hasText: 'Population' }).click();
  await expect(page.locator('#census-legend')).toBeVisible({ timeout: 30_000 });

  // Switch to density
  await page.locator('#overlays-panel label').filter({ hasText: 'Density' }).click();

  // Legend should still be visible (fill-color changed, data already loaded)
  await expect(page.locator('#census-legend')).toBeVisible();
  // No error should appear
  await expect(page.locator('#census-error')).toBeHidden();
});

test('switching to Off hides legend', async ({ page }) => {
  await page.goto(BASE);
  await waitForMapLoad(page);

  await page.locator('#overlays-panel label').filter({ hasText: 'Population' }).click();
  await expect(page.locator('#census-legend')).toBeVisible({ timeout: 30_000 });

  await page.locator('#overlays-panel label').filter({ hasText: 'Off' }).click();
  await expect(page.locator('#census-legend')).toBeHidden();
});

