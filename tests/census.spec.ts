import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:5174';

async function waitForMapLoad(page: import('@playwright/test').Page) {
  await page.waitForFunction(
    () => {
      const w = window as unknown as Record<string, unknown>;
      return !!w['__map'] && !!w['__networkEditor'];
    },
    { timeout: 20_000 },
  );
  await expect(page.locator('#map canvas')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('#overlays-panel')).toBeVisible({ timeout: 20_000 });
}

async function waitForCensusLayer(page: import('@playwright/test').Page, layerId = 'census-msoa-fill') {
  await page.waitForFunction((targetLayerId) => {
    const map = (window as unknown as {
      __map?: {
        getLayer: (id: string) => unknown;
        getLayoutProperty: (id: string, name: string) => unknown;
      };
    }).__map;

    if (!map?.getLayer(targetLayerId)) return false;
    return map.getLayoutProperty(targetLayerId, 'visibility') === 'visible';
  }, layerId, { timeout: 30_000 });
}

test('map loads and census metric controls render', async ({ page }) => {
  await page.goto(BASE);
  await expect(page.locator('#map canvas')).toBeVisible({ timeout: 15_000 });

  const radios = page.locator('input[name="census-metric"]');
  await expect(radios).toHaveCount(13);
});

test('census data files are populated and include required properties', async ({ page }) => {
  const lsoaRes = await page.request.get(`${BASE}/data/lsoa_boundaries.geojson`);
  expect(lsoaRes.ok()).toBe(true);
  const lsoaJson = await lsoaRes.json();
  expect(lsoaJson.features.length).toBeGreaterThan(30_000);

  const msoaRes = await page.request.get(`${BASE}/data/msoa_boundaries.geojson`);
  expect(msoaRes.ok()).toBe(true);
  const msoaJson = await msoaRes.json();
  expect(msoaJson.features.length).toBeGreaterThan(5_000);

  for (const f of lsoaJson.features.slice(0, 10)) {
    expect(typeof f.properties.pop).toBe('number');
    expect(typeof f.properties.work_pop).toBe('number');
    expect(f.properties.pop).toBeGreaterThan(0);
  }

  for (const f of msoaJson.features.slice(0, 10)) {
    expect(typeof f.properties.pop).toBe('number');
    expect(typeof f.properties.work_pop).toBe('number');
    expect(f.properties.pop).toBeGreaterThan(0);
  }
});

test('Population metric enables census layer and displays legend without errors', async ({ page }) => {
  await page.goto(BASE);
  await waitForMapLoad(page);

  await page.locator('#overlays-panel label').filter({ hasText: 'Population' }).click();
  await waitForCensusLayer(page);

  await expect(page.locator('#census-legend')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#census-error')).toBeHidden();
});

test('switching Population -> Density keeps legend visible, Off hides it', async ({ page }) => {
  await page.goto(BASE);
  await waitForMapLoad(page);

  await page.locator('#overlays-panel label').filter({ hasText: 'Population' }).click();
  await waitForCensusLayer(page);
  await expect(page.locator('#census-legend')).toBeVisible({ timeout: 30_000 });

  await page.locator('#overlays-panel label').filter({ hasText: 'Density' }).click();
  await waitForCensusLayer(page);
  await expect(page.locator('#census-legend')).toBeVisible();
  await expect(page.locator('#census-error')).toBeHidden();

  await page.locator('#overlays-panel label').filter({ hasText: 'Off' }).click();
  await expect(page.locator('#census-legend')).toBeHidden();
});

test('No Car/Van metric enables layer and shows legend', async ({ page }) => {
  await page.goto(BASE);
  await waitForMapLoad(page);

  await page.locator('#overlays-panel label').filter({ hasText: 'No Car/Van %' }).click();
  await waitForCensusLayer(page);

  await expect(page.locator('#census-legend')).toBeVisible();
  await expect(page.locator('#census-error')).toBeHidden();
});
