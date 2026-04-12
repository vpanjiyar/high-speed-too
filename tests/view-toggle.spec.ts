import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:5174';

type TestMap = {
  getPaintProperty: (layerId: string, prop: string) => unknown;
  getLayoutProperty: (layerId: string, prop: string) => unknown;
};

async function waitForMap(page: import('@playwright/test').Page) {
  await page.waitForFunction(
    () => {
      const w = window as unknown as Record<string, unknown>;
      return !!w['__map'] && !!w['__networkEditor'];
    },
    { timeout: 20_000 },
  );
  await expect(page.locator('#map canvas')).toBeVisible({ timeout: 20_000 });
}

function mapSnapshot(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const map = (window as unknown as { __map: TestMap }).__map;
    return {
      background: map.getPaintProperty('background', 'background-color'),
      land: map.getPaintProperty('earth-fill', 'fill-color'),
      ocean: map.getPaintProperty('ocean-fill', 'fill-color'),
      forestVisibility: map.getLayoutProperty('landcover-forest', 'visibility'),
      urbanVisibility: map.getLayoutProperty('landuse-urban', 'visibility'),
      buildingVisibility: map.getLayoutProperty('building-fill', 'visibility'),
    };
  });
}

test('view toggle panel renders and defaults to detailed', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await expect(page.locator('#view-toggle')).toBeVisible();
  await expect(page.locator('#view-btn-detailed')).toHaveClass(/view-btn--active/);
  await expect(page.locator('#view-btn-schematic')).not.toHaveClass(/view-btn--active/);
});

test('switching to schematic applies expected palette and layer visibility', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await page.locator('#view-btn-schematic').click();
  await expect(page.locator('#view-btn-schematic')).toHaveClass(/view-btn--active/);

  const snap = await mapSnapshot(page);
  expect(snap.background).toBe('#EBEBEB');
  expect(snap.land).toBe('#FFFFFF');
  expect(snap.ocean).toBe('#D4D4D4');
  expect(snap.forestVisibility).toBe('none');
  expect(snap.urbanVisibility).toBe('none');
  expect(snap.buildingVisibility).toBe('none');
});

test('switching back to detailed restores expected palette and visibility', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await page.locator('#view-btn-schematic').click();
  await page.locator('#view-btn-detailed').click();
  await expect(page.locator('#view-btn-detailed')).toHaveClass(/view-btn--active/);

  const snap = await mapSnapshot(page);
  expect(snap.background).toBe('#B0CCDF');
  expect(snap.land).toBe('#F4EFE0');
  expect(snap.forestVisibility).toBe('visible');
  expect(snap.buildingVisibility).toBe('visible');
});

test('idempotent clicks keep mode stable', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await page.locator('#view-btn-schematic').click();
  await page.locator('#view-btn-schematic').click();
  await expect(page.locator('#view-btn-schematic')).toHaveClass(/view-btn--active/);

  await page.locator('#view-btn-detailed').click();
  await page.locator('#view-btn-detailed').click();
  await expect(page.locator('#view-btn-detailed')).toHaveClass(/view-btn--active/);
});

test('overlay toggles work in schematic and state persists across mode switches', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await page.locator('#view-btn-schematic').click();

  const railToggleLabel = page.locator('label.overlay-toggle').filter({ has: page.locator('#toggle-rail-lines') });
  const metroToggleLabel = page.locator('label.overlay-toggle').filter({ has: page.locator('#toggle-metro-lines') });
  const stationsToggleLabel = page.locator('label.overlay-toggle').filter({ has: page.locator('#toggle-rail-stations') });

  await railToggleLabel.click();
  await metroToggleLabel.click();
  await stationsToggleLabel.click();

  await expect(page.locator('#toggle-rail-lines')).not.toBeChecked();
  await expect(page.locator('#toggle-metro-lines')).not.toBeChecked();
  await expect(page.locator('#toggle-rail-stations')).not.toBeChecked();

  await page.locator('#view-btn-detailed').click();
  await expect(page.locator('#toggle-rail-lines')).not.toBeChecked();
  await expect(page.locator('#toggle-metro-lines')).not.toBeChecked();
  await expect(page.locator('#toggle-rail-stations')).not.toBeChecked();
});

test('schematic mode does not hide user-drawn network layers', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await page.locator('#tool-line').click();
  await page.locator('#new-line-add').click();
  const canvas = await page.locator('#map canvas').boundingBox();
  await page.mouse.click(canvas!.x + canvas!.width / 2, canvas!.y + canvas!.height / 2);
  await page.waitForTimeout(100);
  await page.locator('#line-manager-close').click();

  await page.locator('#tool-station').click();
  await page.mouse.click(canvas!.x + canvas!.width / 2 + 40, canvas!.y + canvas!.height / 2 + 40);
  await page.waitForTimeout(100);

  await page.locator('#view-btn-schematic').click();

  const visibility = await page.evaluate(() => {
    const map = (window as unknown as { __map: TestMap }).__map;
    return {
      networkLine: map.getLayoutProperty('network-line', 'visibility'),
      stationOuter: map.getLayoutProperty('network-station-outer', 'visibility'),
    };
  });

  expect(visibility.networkLine).not.toBe('none');
  expect(visibility.stationOuter).not.toBe('none');
});
