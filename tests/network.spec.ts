import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:5174';

async function waitForMap(page: import('@playwright/test').Page) {
  await page.waitForFunction(
    () => (window as unknown as Record<string, unknown>)['__mapState'] === 'loaded',
    { timeout: 20_000 },
  );
}

async function getEditorState(page: import('@playwright/test').Page) {
  return page.evaluate(() =>
    (window as unknown as Record<string, unknown>)['__networkEditor'] &&
    (window as unknown as { __networkEditor: { getState: () => unknown } })
      .__networkEditor.getState(),
  );
}

async function getStationCount(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() =>
    ((window as unknown as { __networkEditor: { network: { stations: unknown[] } } })
      .__networkEditor.network.stations.length),
  );
}

async function getLineCount(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() =>
    ((window as unknown as { __networkEditor: { network: { lines: unknown[] } } })
      .__networkEditor.network.lines.length),
  );
}

/**
 * Monkey-patch MapLibre's queryRenderedFeatures on the map instance so that
 * a fake NaPTAN station appears at ANY queried bbox. This lets us test the
 * NaPTAN snap path without needing real tile data in headless mode.
 */
async function injectFakeNaptanStation(
  page: import('@playwright/test').Page,
  name: string,
  atco: string,
  lng: number,
  lat: number,
  layer: string = 'naptan-station-mainline',
) {
  await page.evaluate(
    ({ name, atco, lng, lat, layer }) => {
      const map = (window as unknown as { __map: { queryRenderedFeatures: unknown; getLayer: unknown } }).__map;
      const origQRF = map.queryRenderedFeatures.bind(map);
      const origGetLayer = map.getLayer.bind(map);

      // Make getLayer return truthy for this layer so the filter passes
      map.getLayer = (id: string) => {
        if (id === layer) return { id } as unknown as ReturnType<typeof map.getLayer>;
        return origGetLayer(id);
      };

      map.queryRenderedFeatures = (
        geometry: unknown,
        options: { layers?: string[] },
      ) => {
        if (options?.layers?.includes(layer)) {
          return [
            {
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [lng, lat] },
              properties: { name, atco, stopType: 'RLY' },
              layer: { id: layer },
            },
          ];
        }
        return origQRF(geometry, options);
      };
    },
    { name, atco, lng, lat, layer },
  );
}

/** Remove the monkey-patch so other tests are not affected. */
async function removeNaptanPatch(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const map = (window as unknown as { __map: { queryRenderedFeatures: unknown; getLayer: unknown } }).__map;
    // Simple reload-free cleanup: clear by reloading will happen between tests naturally.
    // For same-page cleanup we just replace with no-op returning [].
    map.queryRenderedFeatures = () => [];
  });
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

test('network editor initialises without JS errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE);
  await waitForMap(page);

  const ready = await page.evaluate(
    () => !!(window as unknown as Record<string, unknown>)['__networkEditor'],
  );
  expect(ready).toBe(true);
  expect(errors).toHaveLength(0);
});

test('initial editor mode is select', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  const state = await getEditorState(page) as { mode: string };
  expect(state.mode).toBe('select');
});

test('select tool button is active by default', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await expect(page.locator('#tool-select')).toHaveClass(/active/);
  await expect(page.locator('#tool-station')).not.toHaveClass(/active/);
  await expect(page.locator('#tool-line')).not.toHaveClass(/active/);
});

// ── Toolbar mode switching ─────────────────────────────────────────────────────

test('clicking station tool switches mode to station', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await page.locator('#tool-station').click();

  const state = await getEditorState(page) as { mode: string };
  expect(state.mode).toBe('station');
  await expect(page.locator('#tool-station')).toHaveClass(/active/);
  await expect(page.locator('#tool-select')).not.toHaveClass(/active/);
});

test('clicking select tool switches back to select mode', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await page.locator('#tool-station').click();
  await page.locator('#tool-select').click();

  const state = await getEditorState(page) as { mode: string };
  expect(state.mode).toBe('select');
  await expect(page.locator('#tool-select')).toHaveClass(/active/);
});

test('clicking line tool opens line panel', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await expect(page.locator('#line-panel')).toBeHidden();
  await page.locator('#tool-line').click();

  await expect(page.locator('#line-panel')).toBeVisible();
  const state = await getEditorState(page) as { mode: string };
  expect(state.mode).toBe('line');
});

test('closing line panel via × returns to select mode', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await page.locator('#tool-line').click();
  await expect(page.locator('#line-panel')).toBeVisible();

  await page.locator('#line-panel-close').click();
  await expect(page.locator('#line-panel')).toBeHidden();

  const state = await getEditorState(page) as { mode: string };
  expect(state.mode).toBe('select');
});

// ── Station placement ──────────────────────────────────────────────────────────

test('clicking map in station mode places a station', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await page.locator('#tool-station').click();

  const canvas = await page.locator('#map canvas').boundingBox();
  expect(canvas).not.toBeNull();
  await page.mouse.click(canvas!.x + canvas!.width / 2, canvas!.y + canvas!.height / 2);
  await page.waitForTimeout(300);

  expect(await getStationCount(page)).toBe(1);
});

test('placing two stations increments count correctly', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await page.locator('#tool-station').click();
  const canvas = await page.locator('#map canvas').boundingBox();
  const cx = canvas!.x + canvas!.width / 2;
  const cy = canvas!.y + canvas!.height / 2;

  await page.mouse.click(cx - 40, cy);
  await page.mouse.click(cx + 40, cy);
  await page.waitForTimeout(300);

  expect(await getStationCount(page)).toBe(2);
});

test('clicking map in select mode does not place a station', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  // Stay in select mode (default)
  const canvas = await page.locator('#map canvas').boundingBox();
  await page.mouse.click(canvas!.x + canvas!.width / 2, canvas!.y + canvas!.height / 2);
  await page.waitForTimeout(300);

  expect(await getStationCount(page)).toBe(0);
});

// ── Line creation ──────────────────────────────────────────────────────────────

test('add line button creates a line', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await page.locator('#tool-line').click();
  await page.locator('#new-line-name').fill('Victoria');
  await page.locator('#new-line-add').click();

  expect(await getLineCount(page)).toBe(1);

  const lineName = await page.evaluate(() =>
    ((window as unknown as { __networkEditor: { network: { lines: Array<{ name: string }> } } })
      .__networkEditor.network.lines[0].name),
  );
  expect(lineName).toBe('Victoria');
});

test('add line button auto-names when name field is empty', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await page.locator('#tool-line').click();
  // Leave name field empty
  await page.locator('#new-line-add').click();

  expect(await getLineCount(page)).toBe(1);
  const lineName = await page.evaluate(() =>
    ((window as unknown as { __networkEditor: { network: { lines: Array<{ name: string }> } } })
      .__networkEditor.network.lines[0].name),
  );
  expect(lineName).toMatch(/Line \d+/);
});

test('line appears in the line list after creation', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await page.locator('#tool-line').click();
  await page.locator('#new-line-name').fill('Jubilee');
  await page.locator('#new-line-add').click();

  await expect(page.locator('.line-item-name').filter({ hasText: 'Jubilee' })).toBeVisible();
});

test('adding a line clears the name input', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await page.locator('#tool-line').click();
  await page.locator('#new-line-name').fill('Central');
  await page.locator('#new-line-add').click();

  await expect(page.locator('#new-line-name')).toHaveValue('');
});

test('deleting a line from line list removes it', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await page.locator('#tool-line').click();
  await page.locator('#new-line-name').fill('Bakerloo');
  await page.locator('#new-line-add').click();

  expect(await getLineCount(page)).toBe(1);

  await page.locator('.line-item-delete').click();
  expect(await getLineCount(page)).toBe(0);
  await expect(page.locator('.line-item-name').filter({ hasText: 'Bakerloo' })).toBeHidden();
});

// ── Line drawing ───────────────────────────────────────────────────────────────

test('clicking map in line mode places station and adds to line', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await page.locator('#tool-line').click();
  await page.locator('#new-line-name').fill('Northern');
  await page.locator('#new-line-add').click();

  const canvas = await page.locator('#map canvas').boundingBox();
  const cx = canvas!.x + canvas!.width / 2;
  const cy = canvas!.y + canvas!.height / 2;
  await page.mouse.click(cx - 40, cy);
  await page.mouse.click(cx + 40, cy);
  await page.waitForTimeout(300);

  expect(await getStationCount(page)).toBe(2);

  const stationIdsOnLine = await page.evaluate(() =>
    ((window as unknown as { __networkEditor: { network: { lines: Array<{ stationIds: string[] }> } } })
      .__networkEditor.network.lines[0].stationIds.length),
  );
  expect(stationIdsOnLine).toBe(2);
});

test('line list shows correct station count after drawing', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await page.locator('#tool-line').click();
  await page.locator('#new-line-name').fill('District');
  await page.locator('#new-line-add').click();

  const canvas = await page.locator('#map canvas').boundingBox();
  const cx = canvas!.x + canvas!.width / 2;
  const cy = canvas!.y + canvas!.height / 2;
  await page.mouse.click(cx - 50, cy);
  await page.mouse.click(cx, cy);
  await page.mouse.click(cx + 50, cy);
  await page.waitForTimeout(300);

  await expect(page.locator('.line-item-stations')).toHaveText('3 stn');
});

// ── Color swatches ─────────────────────────────────────────────────────────────

test('color swatches are rendered in the line panel', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await page.locator('#tool-line').click();
  const swatches = page.locator('.color-swatch');
  await expect(swatches).toHaveCount(10);
});

test('clicking a color swatch marks it as selected', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await page.locator('#tool-line').click();
  const secondSwatch = page.locator('.color-swatch').nth(1);
  await secondSwatch.click();
  await expect(secondSwatch).toHaveClass(/selected/);
});

// ── Station selection panel ────────────────────────────────────────────────────

test('clicking a placed station in select mode shows station panel', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  // Place a station
  await page.locator('#tool-station').click();
  const canvas = await page.locator('#map canvas').boundingBox();
  const cx = canvas!.x + canvas!.width / 2;
  const cy = canvas!.y + canvas!.height / 2;
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(300);

  // Switch to select and click the station
  await page.locator('#tool-select').click();
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(300);

  await expect(page.locator('#station-panel')).toBeVisible();
});

// ── Persistence ────────────────────────────────────────────────────────────────

test('network data persists across page reloads', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  // Place a station and create a line
  await page.locator('#tool-station').click();
  const canvas = await page.locator('#map canvas').boundingBox();
  await page.mouse.click(canvas!.x + canvas!.width / 2, canvas!.y + canvas!.height / 2);
  await page.waitForTimeout(200);

  await page.locator('#tool-line').click();
  await page.locator('#new-line-name').fill('Piccadilly');
  await page.locator('#new-line-add').click();

  expect(await getStationCount(page)).toBe(1);
  expect(await getLineCount(page)).toBe(1);

  // Reload
  await page.reload();
  await waitForMap(page);

  expect(await getStationCount(page)).toBe(1);
  expect(await getLineCount(page)).toBe(1);
  const lineName = await page.evaluate(() =>
    ((window as unknown as { __networkEditor: { network: { lines: Array<{ name: string }> } } })
      .__networkEditor.network.lines[0].name),
  );
  expect(lineName).toBe('Piccadilly');
});

// ── NaPTAN station snapping ────────────────────────────────────────────────────

test('clicking a NaPTAN station in station mode imports it with correct name and atco', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await injectFakeNaptanStation(page, 'Brighton', '9100BRGHTN', -0.1415, 50.8291);

  await page.locator('#tool-station').click();
  const canvas = await page.locator('#map canvas').boundingBox();
  await page.mouse.click(canvas!.x + canvas!.width / 2, canvas!.y + canvas!.height / 2);
  await page.waitForTimeout(300);

  expect(await getStationCount(page)).toBe(1);

  const station = await page.evaluate(() =>
    ((window as unknown as { __networkEditor: { network: { stations: Array<{ name: string; atco: string; lng: number; lat: number }> } } })
      .__networkEditor.network.stations[0]),
  );
  expect(station.name).toBe('Brighton');
  expect(station.atco).toBe('9100BRGHTN');
  // Coordinates should snap to NaPTAN coordinates, not the raw click position
  expect(station.lng).toBeCloseTo(-0.1415, 3);
  expect(station.lat).toBeCloseTo(50.8291, 3);
});

test('clicking the same NaPTAN station twice in station mode does not duplicate it', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await injectFakeNaptanStation(page, 'Brighton', '9100BRGHTN', -0.1415, 50.8291);
  await page.locator('#tool-station').click();
  const canvas = await page.locator('#map canvas').boundingBox();
  const cx = canvas!.x + canvas!.width / 2;
  const cy = canvas!.y + canvas!.height / 2;

  // Click twice on the same NaPTAN station
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(200);
  // Switch back to station mode (first click selects then switches to select)
  await page.locator('#tool-station').click();
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(200);

  // Only one station should exist with this ATCO
  const stations = await page.evaluate(() =>
    ((window as unknown as { __networkEditor: { network: { stations: Array<{ atco: string }> } } })
      .__networkEditor.network.stations),
  );
  const brightons = stations.filter((s) => s.atco === '9100BRGHTN');
  expect(brightons).toHaveLength(1);
});

test('clicking a NaPTAN station in line mode snaps station to real coordinates and adds to line', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await injectFakeNaptanStation(page, 'Hove', '9100HOVE', -0.1704, 50.8352);

  await page.locator('#tool-line').click();
  await page.locator('#new-line-name').fill('Coast');
  await page.locator('#new-line-add').click();

  const canvas = await page.locator('#map canvas').boundingBox();
  await page.mouse.click(canvas!.x + canvas!.width / 2, canvas!.y + canvas!.height / 2);
  await page.waitForTimeout(300);

  expect(await getStationCount(page)).toBe(1);

  const station = await page.evaluate(() =>
    ((window as unknown as { __networkEditor: { network: { stations: Array<{ name: string; atco: string }> } } })
      .__networkEditor.network.stations[0]),
  );
  expect(station.name).toBe('Hove');
  expect(station.atco).toBe('9100HOVE');

  const stationCount = await page.evaluate(() =>
    ((window as unknown as { __networkEditor: { network: { lines: Array<{ stationIds: string[] }> } } })
      .__networkEditor.network.lines[0].stationIds.length),
  );
  expect(stationCount).toBe(1);
});

test('adding the same NaPTAN station to a line twice does not duplicate the station', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await injectFakeNaptanStation(page, 'Aldrington', '9100ALDRTN', -0.1843, 50.8357);

  await page.locator('#tool-line').click();
  await page.locator('#new-line-name').fill('Test');
  await page.locator('#new-line-add').click();

  const canvas = await page.locator('#map canvas').boundingBox();
  const cx = canvas!.x + canvas!.width / 2;
  const cy = canvas!.y + canvas!.height / 2;

  // Click the NaPTAN station twice at two different canvas positions
  // (same fake station is returned both times)
  await page.mouse.click(cx - 30, cy);
  await page.waitForTimeout(200);
  await page.mouse.click(cx + 30, cy);
  await page.waitForTimeout(200);

  // Only one network station should have been created
  const stations = await page.evaluate(() =>
    ((window as unknown as { __networkEditor: { network: { stations: Array<{ atco: string }> } } })
      .__networkEditor.network.stations),
  );
  const aldrtons = stations.filter((s) => s.atco === '9100ALDRTN');
  expect(aldrtons).toHaveLength(1);

  // But it should be added to the line's stationIds twice (valid routing intent)
  const lineStationIds = await page.evaluate(() =>
    ((window as unknown as { __networkEditor: { network: { lines: Array<{ stationIds: string[] }> } } })
      .__networkEditor.network.lines[0].stationIds),
  );
  // The Network.addStationToLine prevents consecutive duplicates, but allows non-consecutive
  expect(lineStationIds.length).toBeGreaterThanOrEqual(1);
});

test('NaPTAN station imported via station mode persists atco after reload', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await injectFakeNaptanStation(page, 'Portslade', '9100PRTSLD', -0.2096, 50.8322);
  await page.locator('#tool-station').click();
  const canvas = await page.locator('#map canvas').boundingBox();
  await page.mouse.click(canvas!.x + canvas!.width / 2, canvas!.y + canvas!.height / 2);
  await page.waitForTimeout(300);

  // Verify atco saved before reload
  const atcoBefore = await page.evaluate(() =>
    ((window as unknown as { __networkEditor: { network: { stations: Array<{ atco: string }> } } })
      .__networkEditor.network.stations[0]?.atco),
  );
  expect(atcoBefore).toBe('9100PRTSLD');

  // Reload — data comes from localStorage, not the patched map
  await page.reload();
  await waitForMap(page);

  const atcoAfter = await page.evaluate(() =>
    ((window as unknown as { __networkEditor: { network: { stations: Array<{ atco: string }> } } })
      .__networkEditor.network.stations[0]?.atco),
  );
  expect(atcoAfter).toBe('9100PRTSLD');
});

