import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:5174';

type TestMap = {
  getPaintProperty:  (layerId: string, prop: string) => unknown;
  getLayoutProperty: (layerId: string, prop: string) => unknown;
  getLayer:          (layerId: string) => { minzoom?: number; maxzoom?: number } | undefined;
};

async function waitForMap(page: import('@playwright/test').Page) {
  await page.waitForFunction(
    () => (window as unknown as Record<string, unknown>)['__mapState'] === 'loaded',
    { timeout: 20_000 },
  );
}

function getMap(page: import('@playwright/test').Page) {
  return (window as unknown as { __map: TestMap }).__map;
}

// ── Panel rendering ───────────────────────────────────────────────────────────

test('view toggle panel is visible on load', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await expect(page.locator('#view-toggle')).toBeVisible();
});

test('detailed and schematic buttons both render', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await expect(page.locator('#view-btn-detailed')).toBeVisible();
  await expect(page.locator('#view-btn-schematic')).toBeVisible();
});

// ── Default state ─────────────────────────────────────────────────────────────

test('detailed button is active by default', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await expect(page.locator('#view-btn-detailed')).toHaveClass(/view-btn--active/);
  await expect(page.locator('#view-btn-schematic')).not.toHaveClass(/view-btn--active/);
});

// ── Switching to schematic ────────────────────────────────────────────────────

test('clicking schematic activates the schematic button', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await page.locator('#view-btn-schematic').click();

  await expect(page.locator('#view-btn-schematic')).toHaveClass(/view-btn--active/);
  await expect(page.locator('#view-btn-detailed')).not.toHaveClass(/view-btn--active/);
});

test('schematic mode sets background to off-white (#EBEBEB)', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await page.locator('#view-btn-schematic').click();

  const color = await page.evaluate(
    (fn) => eval(`(${fn})()`),
    `() => (window.__map).getPaintProperty('background', 'background-color')`,
  );
  expect(color).toBe('#EBEBEB');
});

test('schematic mode sets land fill to white (#FFFFFF)', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await page.locator('#view-btn-schematic').click();

  const color = await page.evaluate(() =>
    (window as unknown as { __map: TestMap }).__map
      .getPaintProperty('earth-fill', 'fill-color'),
  );
  expect(color).toBe('#FFFFFF');
});

test('schematic mode sets ocean fill to light grey (#D4D4D4)', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await page.locator('#view-btn-schematic').click();

  const color = await page.evaluate(() =>
    (window as unknown as { __map: TestMap }).__map
      .getPaintProperty('ocean-fill', 'fill-color'),
  );
  expect(color).toBe('#D4D4D4');
});

test('schematic mode hides landcover-forest', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await page.locator('#view-btn-schematic').click();

  const visibility = await page.evaluate(() =>
    (window as unknown as { __map: TestMap }).__map
      .getLayoutProperty('landcover-forest', 'visibility'),
  );
  expect(visibility).toBe('none');
});

test('schematic mode hides landuse-urban', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await page.locator('#view-btn-schematic').click();

  const visibility = await page.evaluate(() =>
    (window as unknown as { __map: TestMap }).__map
      .getLayoutProperty('landuse-urban', 'visibility'),
  );
  expect(visibility).toBe('none');
});

test('schematic mode hides buildings', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await page.locator('#view-btn-schematic').click();

  const visibility = await page.evaluate(() =>
    (window as unknown as { __map: TestMap }).__map
      .getLayoutProperty('building-fill', 'visibility'),
  );
  expect(visibility).toBe('none');
});

// ── Switching back to detailed ────────────────────────────────────────────────

test('clicking detailed from schematic restores detailed as active', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await page.locator('#view-btn-schematic').click();
  await page.locator('#view-btn-detailed').click();

  await expect(page.locator('#view-btn-detailed')).toHaveClass(/view-btn--active/);
  await expect(page.locator('#view-btn-schematic')).not.toHaveClass(/view-btn--active/);
});

test('returning to detailed restores background color (#B0CCDF)', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await page.locator('#view-btn-schematic').click();
  await page.locator('#view-btn-detailed').click();

  const color = await page.evaluate(() =>
    (window as unknown as { __map: TestMap }).__map
      .getPaintProperty('background', 'background-color'),
  );
  expect(color).toBe('#B0CCDF');
});

test('returning to detailed restores land fill color (#F4EFE0)', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await page.locator('#view-btn-schematic').click();
  await page.locator('#view-btn-detailed').click();

  const color = await page.evaluate(() =>
    (window as unknown as { __map: TestMap }).__map
      .getPaintProperty('earth-fill', 'fill-color'),
  );
  expect(color).toBe('#F4EFE0');
});

test('returning to detailed restores landcover-forest visibility', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await page.locator('#view-btn-schematic').click();
  await page.locator('#view-btn-detailed').click();

  const visibility = await page.evaluate(() =>
    (window as unknown as { __map: TestMap }).__map
      .getLayoutProperty('landcover-forest', 'visibility'),
  );
  expect(visibility).toBe('visible');
});

test('returning to detailed restores building visibility', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await page.locator('#view-btn-schematic').click();
  await page.locator('#view-btn-detailed').click();

  const visibility = await page.evaluate(() =>
    (window as unknown as { __map: TestMap }).__map
      .getLayoutProperty('building-fill', 'visibility'),
  );
  expect(visibility).toBe('visible');
});

// ── Idempotent clicks ─────────────────────────────────────────────────────────

test('clicking schematic twice stays in schematic mode', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await page.locator('#view-btn-schematic').click();
  await page.locator('#view-btn-schematic').click(); // no-op second click

  await expect(page.locator('#view-btn-schematic')).toHaveClass(/view-btn--active/);

  const color = await page.evaluate(() =>
    (window as unknown as { __map: TestMap }).__map
      .getPaintProperty('background', 'background-color'),
  );
  expect(color).toBe('#EBEBEB');
});

test('clicking detailed twice stays in detailed mode', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await page.locator('#view-btn-detailed').click(); // already active — no-op
  await page.locator('#view-btn-detailed').click();

  await expect(page.locator('#view-btn-detailed')).toHaveClass(/view-btn--active/);

  const color = await page.evaluate(() =>
    (window as unknown as { __map: TestMap }).__map
      .getPaintProperty('background', 'background-color'),
  );
  expect(color).toBe('#B0CCDF');
});

// ── Rail infrastructure overlay toggles in schematic mode ────────────────────

test('national rail overlay toggle works in schematic mode', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await page.locator('#view-btn-schematic').click();

  const railToggleLabel = page.locator('label.overlay-toggle').filter({
    has: page.locator('#toggle-rail-lines'),
  });

  // Initially checked
  await expect(page.locator('#toggle-rail-lines')).toBeChecked();

  // Uncheck via the visible label
  await railToggleLabel.click();
  await expect(page.locator('#toggle-rail-lines')).not.toBeChecked();

  // Re-check
  await railToggleLabel.click();
  await expect(page.locator('#toggle-rail-lines')).toBeChecked();
});

test('city metro overlay toggle works in schematic mode', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await page.locator('#view-btn-schematic').click();

  const metroToggleLabel = page.locator('label.overlay-toggle').filter({
    has: page.locator('#toggle-metro-lines'),
  });

  await expect(page.locator('#toggle-metro-lines')).toBeChecked();
  await metroToggleLabel.click();
  await expect(page.locator('#toggle-metro-lines')).not.toBeChecked();
});

test('stations overlay toggle works in schematic mode', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await page.locator('#view-btn-schematic').click();

  const stationsToggleLabel = page.locator('label.overlay-toggle').filter({
    has: page.locator('#toggle-rail-stations'),
  });

  await expect(page.locator('#toggle-rail-stations')).toBeChecked();
  await stationsToggleLabel.click();
  await expect(page.locator('#toggle-rail-stations')).not.toBeChecked();
});

test('overlay toggle state is preserved when switching between modes', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  // Turn off national rail in detailed mode
  await page.locator('label.overlay-toggle').filter({
    has: page.locator('#toggle-rail-lines'),
  }).click();
  await expect(page.locator('#toggle-rail-lines')).not.toBeChecked();

  // Switch to schematic — toggle remains off
  await page.locator('#view-btn-schematic').click();
  await expect(page.locator('#toggle-rail-lines')).not.toBeChecked();

  // Switch back — still off
  await page.locator('#view-btn-detailed').click();
  await expect(page.locator('#toggle-rail-lines')).not.toBeChecked();
});

// ── User-drawn network unaffected ─────────────────────────────────────────────

test('schematic mode does not hide user-drawn network lines', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  // Create a line and draw a stop so the network-line layer exists
  await page.locator('#tool-line').click();
  await page.locator('#new-line-add').click();
  const canvas = await page.locator('#map canvas').boundingBox();
  await page.mouse.click(canvas!.x + canvas!.width / 2, canvas!.y + canvas!.height / 2);
  await page.waitForTimeout(300);

  await page.locator('#view-btn-schematic').click();

  const visibility = await page.evaluate(() =>
    (window as unknown as { __map: TestMap }).__map
      .getLayoutProperty('network-line', 'visibility'),
  );
  // Layer exists but visibility was never set to 'none' by schematic mode
  expect(visibility).not.toBe('none');
});

test('schematic mode does not hide user-drawn station circles', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await page.locator('#tool-station').click();
  const canvas = await page.locator('#map canvas').boundingBox();
  await page.mouse.click(canvas!.x + canvas!.width / 2, canvas!.y + canvas!.height / 2);
  await page.waitForTimeout(300);

  await page.locator('#view-btn-schematic').click();

  const visibility = await page.evaluate(() =>
    (window as unknown as { __map: TestMap }).__map
      .getLayoutProperty('network-station-outer', 'visibility'),
  );
  expect(visibility).not.toBe('none');
});
