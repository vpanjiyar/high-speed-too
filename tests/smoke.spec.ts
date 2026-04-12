import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:5174';

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

test('app boots and map canvas is visible', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);
  await expect(page.locator('#map canvas')).toBeVisible();
});

test('mode toggle works and sim toolbar appears', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await page.locator('#mode-btn-sim').click();
  await expect(page.locator('#mode-btn-sim')).toHaveClass(/mode-btn--active/);
  await expect(page.locator('#sim-toolbar')).toBeVisible();

  await page.locator('#mode-btn-plan').click();
  await expect(page.locator('#sim-toolbar')).toBeHidden();
});

test('placing station in station mode increments station count', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await page.locator('#tool-station').click();
  const canvas = await page.locator('#map canvas').boundingBox();
  await page.mouse.click(canvas!.x + canvas!.width / 2, canvas!.y + canvas!.height / 2);

  const stationCount = await page.evaluate(() =>
    (window as unknown as { __networkEditor: { network: { stations: unknown[] } } })
      .__networkEditor.network.stations.length,
  );
  expect(stationCount).toBeGreaterThanOrEqual(1);
});

test('line creation from panel adds a line', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await page.locator('#tool-line').click();
  await page.locator('#new-line-name').fill('Smoke Line');
  await page.locator('#new-line-add').click();

  const lineCount = await page.evaluate(() =>
    (window as unknown as { __networkEditor: { network: { lines: unknown[] } } })
      .__networkEditor.network.lines.length,
  );
  expect(lineCount).toBeGreaterThanOrEqual(1);
});

test('view toggle switches between detailed and schematic', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await page.locator('#view-btn-schematic').click();
  await expect(page.locator('#view-btn-schematic')).toHaveClass(/view-btn--active/);

  await page.locator('#view-btn-detailed').click();
  await expect(page.locator('#view-btn-detailed')).toHaveClass(/view-btn--active/);
});

test('export modal opens and closes', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await page.locator('#btn-export').click();
  await expect(page.locator('#export-modal')).toBeVisible();
  await page.locator('#export-btn-cancel').click();
  await expect(page.locator('#export-modal')).toBeHidden();
});

test('census overlay can be enabled and legend appears', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await page.locator('#overlays-panel label').filter({ hasText: 'Population' }).click();
  await page.waitForFunction(() => {
    const map = (window as unknown as {
      __map?: { getLayoutProperty: (id: string, key: string) => unknown }
    }).__map;
    return map?.getLayoutProperty('census-msoa-fill', 'visibility') === 'visible';
  }, { timeout: 30_000 });

  await expect(page.locator('#census-legend')).toBeVisible();
});

test('save button is present in history controls', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);
  await expect(page.locator('#btn-save')).toBeVisible();
});
