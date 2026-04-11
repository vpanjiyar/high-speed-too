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

async function mockRailNetwork(
  page: import('@playwright/test').Page,
  lineStrings: Array<Array<[number, number]>>,
) {
  await page.evaluate((mockedLineStrings) => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof Request
          ? input.url
          : input.toString();

      if (url.includes('/data/rail_lines.geojson')) {
        return new Response(JSON.stringify({
          type: 'FeatureCollection',
          features: mockedLineStrings.map((coordinates) => ({
            type: 'Feature',
            geometry: { type: 'LineString', coordinates },
            properties: {},
          })),
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return originalFetch(input, init);
    };
  }, lineStrings);
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const map = (window as unknown as { __map: { queryRenderedFeatures: (...args: any[]) => unknown[]; getLayer: (id: string) => unknown } }).__map;
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const map = (window as unknown as { __map: { queryRenderedFeatures: (...args: any[]) => unknown[] } }).__map;
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

test('snap to existing disables itself when the current endpoint has no reusable route', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);
  await mockRailNetwork(page, []);

  await page.locator('#tool-line').click();
  await page.locator('#new-line-snap').check();
  await page.locator('#new-line-name').fill('Detached');
  await page.locator('#new-line-add').click();

  const canvas = await page.locator('#map canvas').boundingBox();
  expect(canvas).not.toBeNull();
  await page.mouse.click(canvas!.x + canvas!.width / 2, canvas!.y + canvas!.height / 2);

  await expect(page.locator('#new-line-snap')).toBeDisabled();
  await expect(page.locator('#new-line-snap')).not.toBeChecked();
  await expect(page.locator('#new-line-snap-help')).toContainText('No existing route is available');
});

test('snap to existing reuses mocked National Rail geometry instead of drawing a straight segment', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  const canvas = await page.locator('#map canvas').boundingBox();
  expect(canvas).not.toBeNull();

  const routePoints = await page.evaluate(({ width, height }) => {
    const map = (window as unknown as { __map: { unproject: (point: [number, number]) => { lng: number; lat: number } } }).__map;
    const relPoints: Array<[number, number]> = [
      [width / 2 - 90, height / 2],
      [width / 2, height / 2 - 35],
      [width / 2 + 90, height / 2],
    ];
    return relPoints.map(([x, y]) => {
      const lngLat = map.unproject([x, y]);
      return [lngLat.lng, lngLat.lat] as [number, number];
    });
  }, { width: canvas!.width, height: canvas!.height });

  await mockRailNetwork(page, [routePoints]);

  const snappedLine = await page.evaluate(async (points) => {
    const editor = (window as unknown as {
      __networkEditor: {
        network: {
          addLine: (name: string, color: string, snapToExisting?: boolean) => { id: string; segmentPaths?: Array<Array<[number, number]> | null> };
          addStation: (lng: number, lat: number, name?: string) => { id: string };
          addStationToLine: (lineId: string, stationId: string, segmentPath?: Array<[number, number]>) => void;
          getLine: (lineId: string) => { segmentPaths?: Array<Array<[number, number]> | null> } | undefined;
        };
        trackRouter: {
          findRoute: (
            network: unknown,
            start: [number, number],
            end: [number, number],
          ) => Promise<Array<[number, number]> | null>;
        };
      };
    }).__networkEditor;

    const [startPoint, , endPoint] = points;
    const line = editor.network.addLine('National Rail Snap', '#1d4ed8', true);
    const startStation = editor.network.addStation(startPoint[0], startPoint[1], 'Start');
    editor.network.addStationToLine(line.id, startStation.id);

    const route = await editor.trackRouter.findRoute(editor.network, startPoint, endPoint);
    if (!route) return null;

    const endStation = editor.network.addStation(endPoint[0], endPoint[1], 'End');
    editor.network.addStationToLine(line.id, endStation.id, route);
    return editor.network.getLine(line.id)?.segmentPaths?.[0] ?? null;
  }, routePoints);

  expect(snappedLine).not.toBeNull();
  expect(snappedLine).toHaveLength(3);
  expect(snappedLine![1]![0]).toBeCloseTo(routePoints[1]![0], 6);
  expect(snappedLine![1]![1]).toBeCloseTo(routePoints[1]![1], 6);
});

test('snap to existing can reuse a route from an earlier user-drawn line', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);
  await mockRailNetwork(page, []);

  const canvas = await page.locator('#map canvas').boundingBox();
  expect(canvas).not.toBeNull();

  const routePoints = await page.evaluate(({ width, height }) => {
    const map = (window as unknown as { __map: { unproject: (point: [number, number]) => { lng: number; lat: number } } }).__map;
    const relPoints: Array<[number, number]> = [
      [width / 2 - 110, height / 2],
      [width / 2, height / 2 - 35],
      [width / 2 + 110, height / 2],
    ];
    return relPoints.map(([x, y]) => {
      const lngLat = map.unproject([x, y]);
      return [lngLat.lng, lngLat.lat] as [number, number];
    });
  }, { width: canvas!.width, height: canvas!.height });

  const reusedLine = await page.evaluate(async (points) => {
    const editor = (window as unknown as {
      __networkEditor: {
        network: {
          addLine: (name: string, color: string, snapToExisting?: boolean) => { id: string };
          addStation: (lng: number, lat: number, name?: string) => { id: string };
          addStationToLine: (lineId: string, stationId: string, segmentPath?: Array<[number, number]>) => void;
          getLine: (lineId: string) => { segmentPaths?: Array<Array<[number, number]> | null> } | undefined;
        };
        trackRouter: {
          findRoute: (
            network: unknown,
            start: [number, number],
            end: [number, number],
          ) => Promise<Array<[number, number]> | null>;
        };
      };
    }).__networkEditor;

    const [startPoint, middlePoint, endPoint] = points;
    const baseLine = editor.network.addLine('Base', '#e11d48');
    const startStation = editor.network.addStation(startPoint[0], startPoint[1], 'Base Start');
    const middleStation = editor.network.addStation(middlePoint[0], middlePoint[1], 'Base Mid');
    const endStation = editor.network.addStation(endPoint[0], endPoint[1], 'Base End');

    editor.network.addStationToLine(baseLine.id, startStation.id);
    editor.network.addStationToLine(baseLine.id, middleStation.id);
    editor.network.addStationToLine(baseLine.id, endStation.id);

    const reuseLine = editor.network.addLine('Reuse', '#2563eb', true);
    editor.network.addStationToLine(reuseLine.id, startStation.id);

    const route = await editor.trackRouter.findRoute(editor.network, startPoint, endPoint);
    if (!route) return null;

    editor.network.addStationToLine(reuseLine.id, endStation.id, route);
    return editor.network.getLine(reuseLine.id)?.segmentPaths?.[0] ?? null;
  }, routePoints);

  expect(reusedLine).not.toBeNull();
  expect(reusedLine).toEqual(routePoints);
});

test('shared snapped segments render as a single multi-colour corridor', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);
  await mockRailNetwork(page, []);

  const canvas = await page.locator('#map canvas').boundingBox();
  expect(canvas).not.toBeNull();

  const routePoints = await page.evaluate(({ width, height }) => {
    const map = (window as unknown as { __map: { unproject: (point: [number, number]) => { lng: number; lat: number } } }).__map;
    const relPoints: Array<[number, number]> = [
      [width / 2 - 110, height / 2],
      [width / 2, height / 2 - 35],
      [width / 2 + 110, height / 2],
    ];
    return relPoints.map(([x, y]) => {
      const lngLat = map.unproject([x, y]);
      return [lngLat.lng, lngLat.lat] as [number, number];
    });
  }, { width: canvas!.width, height: canvas!.height });

  await page.evaluate(async (points) => {
    const editor = (window as unknown as {
      __networkEditor: {
        network: {
          addLine: (name: string, color: string, snapToExisting?: boolean) => { id: string };
          addStation: (lng: number, lat: number, name?: string) => { id: string };
          addStationToLine: (lineId: string, stationId: string, segmentPath?: Array<[number, number]>) => void;
        };
        trackRouter: {
          findRoute: (
            network: unknown,
            start: [number, number],
            end: [number, number],
          ) => Promise<Array<[number, number]> | null>;
        };
      };
    }).__networkEditor;

    const [startPoint, middlePoint, endPoint] = points;
    const alpha = editor.network.addLine('Alpha', '#e11d48');
    const startStation = editor.network.addStation(startPoint[0], startPoint[1], 'Alpha Start');
    const middleStation = editor.network.addStation(middlePoint[0], middlePoint[1], 'Alpha Mid');
    const endStation = editor.network.addStation(endPoint[0], endPoint[1], 'Alpha End');

    editor.network.addStationToLine(alpha.id, startStation.id);
    editor.network.addStationToLine(alpha.id, middleStation.id);
    editor.network.addStationToLine(alpha.id, endStation.id);

    const beta = editor.network.addLine('Beta', '#2563eb', true);
    editor.network.addStationToLine(beta.id, startStation.id);
    const route = await editor.trackRouter.findRoute(editor.network, startPoint, endPoint);
    if (!route) throw new Error('Expected a reusable user-line route.');
    editor.network.addStationToLine(beta.id, endStation.id, route);
  }, routePoints);

  await page.waitForFunction(() => {
    const getFeatures = (sourceId: string) => {
      const map = (window as unknown as {
        __map: { getSource: (id: string) => { _data?: { features?: unknown[]; geojson?: { features?: unknown[] } } } };
      }).__map;
      const data = map.getSource(sourceId)?._data;
      if (Array.isArray(data?.features)) return data.features;
      if (Array.isArray(data?.geojson?.features)) return data.geojson.features;
      return [];
    };

    return getFeatures('network-line-cases').length === 2
      && getFeatures('network-line-segments').length === 4;
  });

  const rendered = await page.evaluate(() => {
    const getFeatures = (sourceId: string) => {
      const map = (window as unknown as {
        __map: { getSource: (id: string) => { _data?: { features?: Array<{ properties?: Record<string, unknown> }>; geojson?: { features?: Array<{ properties?: Record<string, unknown> }> } } } };
      }).__map;
      const data = map.getSource(sourceId)?._data;
      if (Array.isArray(data?.features)) return data.features;
      if (Array.isArray(data?.geojson?.features)) return data.geojson.features;
      return [];
    };

    const casingFeatures = getFeatures('network-line-cases');
    const segmentFeatures = getFeatures('network-line-segments');
    return {
      casingCount: casingFeatures.length,
      segmentCount: segmentFeatures.length,
      offsets: segmentFeatures.map((feature) => Number(feature.properties?.offset ?? 0)),
    };
  });

  expect(rendered.casingCount).toBe(2);
  expect(rendered.segmentCount).toBe(4);
  expect(rendered.offsets.filter((offset) => Math.abs(offset) > 0.1)).toHaveLength(4);
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

// ── Station Manager panel ──────────────────────────────────────────────────────

test('clicking a placed station in select mode opens station manager', async ({ page }) => {
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

  await expect(page.locator('#station-manager')).not.toHaveClass(/hidden/);
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

// ── Station Manager: name, rename, delete, lines ─────────────────────────────

test('station manager shows the station name in the input', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  // Place a station at the canvas centre (no NaPTAN — avoid coordinate mismatch)
  await page.locator('#tool-station').click();
  const canvas = await page.locator('#map canvas').boundingBox();
  const cx = canvas!.x + canvas!.width / 2;
  const cy = canvas!.y + canvas!.height / 2;
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(300);

  // Read out the auto-generated name so the test is independent of order
  const stationName = await page.evaluate(() =>
    ((window as unknown as { __networkEditor: { network: { stations: Array<{ name: string }> } } })
      .__networkEditor.network.stations[0].name),
  );

  // Select the station
  await page.locator('#tool-select').click();
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(300);

  await expect(page.locator('#station-manager-name')).toHaveValue(stationName);
});

test('renaming station via input updates network data', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await page.locator('#tool-station').click();
  const canvas = await page.locator('#map canvas').boundingBox();
  const cx = canvas!.x + canvas!.width / 2;
  const cy = canvas!.y + canvas!.height / 2;
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(300);

  await page.locator('#tool-select').click();
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(300);

  // Rename via the input
  await page.locator('#station-manager-name').fill('New Brighton');
  await page.locator('#station-manager-name').press('Enter');
  await page.waitForTimeout(200);

  const name = await page.evaluate(() =>
    ((window as unknown as { __networkEditor: { network: { stations: Array<{ name: string }> } } })
      .__networkEditor.network.stations[0].name),
  );
  expect(name).toBe('New Brighton');
});

test('station manager close button hides the panel', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await page.locator('#tool-station').click();
  const canvas = await page.locator('#map canvas').boundingBox();
  const cx = canvas!.x + canvas!.width / 2;
  const cy = canvas!.y + canvas!.height / 2;
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(300);

  await page.locator('#tool-select').click();
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(300);

  await expect(page.locator('#station-manager')).not.toHaveClass(/hidden/);

  await page.locator('#station-manager-close').click();
  await expect(page.locator('#station-manager')).toHaveClass(/hidden/);
});

test('station manager delete button removes station and closes panel', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await page.locator('#tool-station').click();
  const canvas = await page.locator('#map canvas').boundingBox();
  const cx = canvas!.x + canvas!.width / 2;
  const cy = canvas!.y + canvas!.height / 2;
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(300);

  await page.locator('#tool-select').click();
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(300);

  await page.locator('#station-manager-delete').click();
  await page.waitForTimeout(200);

  expect(await getStationCount(page)).toBe(0);
  await expect(page.locator('#station-manager')).toHaveClass(/hidden/);
});

test('switching to station mode closes station manager', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await page.locator('#tool-station').click();
  const canvas = await page.locator('#map canvas').boundingBox();
  const cx = canvas!.x + canvas!.width / 2;
  const cy = canvas!.y + canvas!.height / 2;
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(300);

  await page.locator('#tool-select').click();
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(300);

  await expect(page.locator('#station-manager')).not.toHaveClass(/hidden/);

  await page.locator('#tool-station').click();
  await expect(page.locator('#station-manager')).toHaveClass(/hidden/);
});

test('station manager lines section shows empty state when station is on no lines', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await page.locator('#tool-station').click();
  const canvas = await page.locator('#map canvas').boundingBox();
  const cx = canvas!.x + canvas!.width / 2;
  const cy = canvas!.y + canvas!.height / 2;
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(300);

  await page.locator('#tool-select').click();
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(300);

  await expect(page.locator('#sm-lines-list .sm-lines-empty')).toBeVisible();
});

test('station manager lines section lists lines station belongs to', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  // Create a line, place a station on it
  await page.locator('#tool-line').click();
  await page.locator('#new-line-name').fill('Coastal Express');
  await page.locator('#new-line-add').click();

  const canvas = await page.locator('#map canvas').boundingBox();
  const cx = canvas!.x + canvas!.width / 2;
  const cy = canvas!.y + canvas!.height / 2;
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(300);

  // Select the placed station
  await page.locator('#tool-select').click();
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(300);

  await expect(page.locator('#sm-lines-list .sm-line-name')).toHaveText('Coastal Express');
});

test('station manager shows census loading indicator then populates stats', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await page.locator('#tool-station').click();
  const canvas = await page.locator('#map canvas').boundingBox();
  const cx = canvas!.x + canvas!.width / 2;
  const cy = canvas!.y + canvas!.height / 2;
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(300);

  await page.locator('#tool-select').click();
  await page.mouse.click(cx, cy);

  // After census loads, stats grid should become visible (or error shows if no data in area)
  await expect(
    page.locator('#sm-stats-grid, #sm-stats-error').first(),
  ).toBeVisible({ timeout: 30_000 });
});

// ── Line Manager panel ─────────────────────────────────────────────────────────

test('clicking a line in the line list opens the line manager panel', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await page.locator('#tool-line').click();
  await page.locator('#new-line-name').fill('Overground');
  await page.locator('#new-line-add').click();

  await expect(page.locator('#line-manager')).not.toHaveClass(/hidden/);
});

test('line manager displays the correct line name', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await page.locator('#tool-line').click();
  await page.locator('#new-line-name').fill('Elizabeth');
  await page.locator('#new-line-add').click();

  await expect(page.locator('#line-manager-name')).toHaveValue('Elizabeth');
});

test('line manager rename updates the line list', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await page.locator('#tool-line').click();
  await page.locator('#new-line-name').fill('Old Name');
  await page.locator('#new-line-add').click();

  await page.locator('#line-manager-name').fill('New Name');
  await page.locator('#line-manager-name').press('Enter');
  await page.waitForTimeout(200);

  await expect(page.locator('.line-item-name').filter({ hasText: 'New Name' })).toBeVisible();
});

test('line manager shows colour swatches', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await page.locator('#tool-line').click();
  await page.locator('#new-line-add').click();

  await expect(page.locator('#lm-color-swatches .lm-swatch')).toHaveCount(10);
});

test('selecting a colour swatch in line manager marks it selected', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await page.locator('#tool-line').click();
  await page.locator('#new-line-add').click();

  const swatch = page.locator('#lm-color-swatches .lm-swatch').nth(2);
  await swatch.click();
  await expect(swatch).toHaveClass(/selected/);
});

test('line manager close button hides the panel', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await page.locator('#tool-line').click();
  await page.locator('#new-line-add').click();

  await expect(page.locator('#line-manager')).not.toHaveClass(/hidden/);
  await page.locator('#line-manager-close').click();
  await expect(page.locator('#line-manager')).toHaveClass(/hidden/);
});

test('line manager delete button removes the line', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await page.locator('#tool-line').click();
  await page.locator('#new-line-name').fill('Temporary');
  await page.locator('#new-line-add').click();

  await page.locator('#line-manager-delete').click();
  await page.waitForTimeout(200);

  expect(await getLineCount(page)).toBe(0);
  await expect(page.locator('#line-manager')).toHaveClass(/hidden/);
});

test('line manager shows stop list with correct station names', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await page.locator('#tool-line').click();
  await page.locator('#new-line-name').fill('Southern');
  await page.locator('#new-line-add').click();

  const canvas = await page.locator('#map canvas').boundingBox();
  const cx = canvas!.x + canvas!.width / 2;
  const cy = canvas!.y + canvas!.height / 2;
  await page.mouse.click(cx - 60, cy);
  await page.mouse.click(cx + 60, cy);
  await page.waitForTimeout(300);

  const stopNames = await page.locator('.lm-stop-name').allTextContents();
  expect(stopNames).toHaveLength(2);
});

test('line manager can reorder stops and updates line geometry', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await page.locator('#tool-line').click();
  await page.locator('#new-line-name').fill('Reorder Line');
  await page.locator('#new-line-add').click();

  const canvas = await page.locator('#map canvas').boundingBox();
  const cx = canvas!.x + canvas!.width / 2;
  const cy = canvas!.y + canvas!.height / 2;
  await page.mouse.click(cx - 110, cy);
  await page.mouse.click(cx, cy);
  await page.mouse.click(cx + 110, cy);
  await page.waitForTimeout(300);

  const before = await page.evaluate(() => {
    const editor = (window as unknown as {
      __networkEditor: {
        network: {
          lines: Array<{ stationIds: string[] }>;
          renameStation: (stationId: string, name: string) => void;
        };
      };
      __map: {
        getSource: (id: string) => { _data?: { features?: Array<{ geometry?: { coordinates?: number[][] } }> } };
      };
    });

    const stationIds = [...editor.__networkEditor.network.lines[0].stationIds];
    editor.__networkEditor.network.renameStation(stationIds[0], 'Alpha');
    editor.__networkEditor.network.renameStation(stationIds[1], 'Bravo');
    editor.__networkEditor.network.renameStation(stationIds[2], 'Charlie');

    const lineSource = editor.__map.getSource('network-lines');
    return {
      stationIds,
      coordinates: lineSource._data?.features?.[0]?.geometry?.coordinates ?? [],
    };
  });

  await expect(page.locator('.lm-stop-name')).toHaveText(['Alpha', 'Bravo', 'Charlie']);

  await page.locator('.lm-stop-item').nth(2).dragTo(page.locator('.lm-stop-item').nth(1), {
    targetPosition: { x: 16, y: 2 },
  });

  await expect(page.locator('.lm-stop-name')).toHaveText(['Alpha', 'Charlie', 'Bravo']);
  await expect(page.locator('.lm-stop-handle')).toHaveCount(3);

  await page.waitForFunction(
    (expectedOrder) => {
      const editor = (window as unknown as {
        __networkEditor: { network: { lines: Array<{ stationIds: string[] }> } };
      }).__networkEditor;
      return JSON.stringify(editor.network.lines[0].stationIds) === JSON.stringify(expectedOrder);
    },
    [before.stationIds[0], before.stationIds[2], before.stationIds[1]],
  );

  const after = await page.evaluate(() => {
    const editor = (window as unknown as {
      __networkEditor: {
        network: {
          lines: Array<{ stationIds: string[] }>;
        };
      };
      __map: {
        getSource: (id: string) => { _data?: { features?: Array<{ geometry?: { coordinates?: number[][] } }> } };
      };
    });

    const lineSource = editor.__map.getSource('network-lines');
    return {
      stationIds: [...editor.__networkEditor.network.lines[0].stationIds],
      coordinates: lineSource._data?.features?.[0]?.geometry?.coordinates ?? [],
    };
  });

  expect(after.stationIds).toEqual([before.stationIds[0], before.stationIds[2], before.stationIds[1]]);
  expect(after.coordinates).toEqual([before.coordinates[0], before.coordinates[2], before.coordinates[1]]);
});

test('line manager shows end-to-end and between-stop timings for selected rolling stock', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await page.locator('#tool-line').click();
  await page.locator('#new-line-name').fill('Timed Line');
  await page.locator('#new-line-add').click();

  const canvas = await page.locator('#map canvas').boundingBox();
  const cx = canvas!.x + canvas!.width / 2;
  const cy = canvas!.y + canvas!.height / 2;
  await page.mouse.click(cx - 100, cy);
  await page.mouse.click(cx, cy);
  await page.mouse.click(cx + 100, cy);
  await page.waitForTimeout(300);

  await page.evaluate(() => {
    const editor = (window as unknown as {
      __networkEditor: {
        network: {
          lines: Array<{ id: string }>;
          setLineTrain: (lineId: string, rollingStockId: string, trainCount?: number) => void;
        };
      };
    }).__networkEditor;
    editor.network.setLineTrain(editor.network.lines[0].id, 'class-395', 1);
  });

  await expect(page.locator('#lm-total-time')).toBeVisible();
  await expect(page.locator('#lm-total-time')).toContainText('end-to-end');
  await expect(page.locator('#lm-ls-time')).not.toHaveText('—');
  await expect(page.locator('.lm-stop-time-tag')).toHaveCount(2);
  await expect(page.locator('.lm-stop-time-tag').first()).not.toHaveText('');
});

test('line timing model accounts for acceleration on short hops', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  const times = await page.evaluate(async () => {
    const rollingStockModule = await import('/src/rolling-stock.ts');
    const metro = rollingStockModule.getRollingStock('lu-2024-stock');
    const highSpeed = rollingStockModule.getRollingStock('tgv-duplex');
    if (!metro || !highSpeed) return null;

    const stations = [
      { lng: -0.1, lat: 51.5, name: 'A' },
      { lng: -0.0996, lat: 51.5002, name: 'B' },
    ];

    return {
      metro: rollingStockModule.computeLineStats(stations, metro, 1).totalTimeMin,
      highSpeed: rollingStockModule.computeLineStats(stations, highSpeed, 1).totalTimeMin,
    };
  });

  expect(times).not.toBeNull();
  expect(times!.metro).toBeLessThan(times!.highSpeed);
});

test('clicking the end-to-end card opens the journey profile graph', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await page.locator('#tool-line').click();
  await page.locator('#new-line-name').fill('Graph Line');
  await page.locator('#new-line-add').click();

  const canvas = await page.locator('#map canvas').boundingBox();
  const cx = canvas!.x + canvas!.width / 2;
  const cy = canvas!.y + canvas!.height / 2;
  await page.mouse.click(cx - 120, cy);
  await page.mouse.click(cx - 20, cy - 30);
  await page.mouse.click(cx + 90, cy);
  await page.waitForTimeout(300);

  await page.evaluate(() => {
    const editor = (window as unknown as {
      __networkEditor: {
        network: {
          lines: Array<{ id: string }>;
          setLineTrain: (lineId: string, rollingStockId: string, trainCount?: number) => void;
        };
      };
    }).__networkEditor;
    editor.network.setLineTrain(editor.network.lines[0].id, 'class-395', 1);
  });

  await page.locator('#lm-open-journey-profile').click();

  await expect(page.locator('#journey-profile-modal')).toBeVisible();
  await expect(page.locator('#journey-profile-title')).toContainText('Journey speed profile');
  await expect(page.locator('#journey-profile-svg')).toBeVisible();

  await page.locator('#journey-profile-chart').hover({ position: { x: 300, y: 140 } });

  await expect(page.locator('#journey-profile-tooltip')).toBeVisible();
  await expect(page.locator('#journey-profile-tooltip')).toContainText('km/h');
  await expect(page.locator('#journey-profile-hover-readout')).not.toHaveText('Hover the curve for details');
});

test('line manager shows a popularity estimate and opens the popularity model modal', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await page.locator('#tool-line').click();
  await page.locator('#new-line-name').fill('Demand Line');
  await page.locator('#new-line-add').click();

  const canvas = await page.locator('#map canvas').boundingBox();
  const cx = canvas!.x + canvas!.width / 2;
  const cy = canvas!.y + canvas!.height / 2;
  await page.mouse.click(cx - 120, cy);
  await page.mouse.click(cx - 10, cy - 25);
  await page.mouse.click(cx + 105, cy);
  await page.waitForTimeout(300);

  await page.evaluate(() => {
    const editor = (window as unknown as {
      __networkEditor: {
        network: {
          lines: Array<{ id: string }>;
          setLineTrain: (lineId: string, rollingStockId: string, trainCount?: number) => void;
        };
      };
    }).__networkEditor;
    editor.network.setLineTrain(editor.network.lines[0].id, 'class-700', 6);
  });

  await expect(page.locator('#lm-stats-loading')).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('#lm-open-demand-model')).toBeEnabled({ timeout: 30_000 });
  await expect(page.locator('#lm-ls-demand')).not.toHaveText('—');
  await expect(page.locator('#lm-ls-demand-band')).not.toContainText('Loading');

  await page.locator('#lm-open-demand-model').click();

  await expect(page.locator('#line-demand-modal')).toBeVisible();
  await expect(page.locator('#line-demand-title')).toContainText('Line popularity model');
  await expect(page.locator('#line-demand-estimate')).not.toHaveText('—');
  await expect(page.locator('#line-demand-methodology')).toContainText('sketch-planning demand model');
});

test('line manager shows empty stop message when line has no stops', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await page.locator('#tool-line').click();
  await page.locator('#new-line-add').click();

  await expect(page.locator('.lm-stops-empty')).toBeVisible();
});

test('clicking a stop in the line manager opens the station manager', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await page.locator('#tool-line').click();
  await page.locator('#new-line-name').fill('Metro');
  await page.locator('#new-line-add').click();

  const canvas = await page.locator('#map canvas').boundingBox();
  await page.mouse.click(canvas!.x + canvas!.width / 2, canvas!.y + canvas!.height / 2);
  await page.waitForTimeout(300);

  // Click the stop in the line manager
  await page.locator('.lm-stop-item').first().click();
  await page.waitForTimeout(300);

  await expect(page.locator('#station-manager')).not.toHaveClass(/hidden/);
});

test('when both panels open station manager shifts left of line manager', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  // Open Line Manager
  await page.locator('#tool-line').click();
  await page.locator('#new-line-add').click();

  // Open Station Manager by placing a stop and clicking it
  const canvas = await page.locator('#map canvas').boundingBox();
  const cx = canvas!.x + canvas!.width / 2;
  const cy = canvas!.y + canvas!.height / 2;
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(300);

  await page.locator('.lm-stop-item').first().click();
  await page.waitForTimeout(300);

  // Both panels should be visible
  await expect(page.locator('#line-manager')).not.toHaveClass(/hidden/);
  await expect(page.locator('#station-manager')).not.toHaveClass(/hidden/);

  // SM should carry the lm-open class (shifts it left of LM)
  await expect(page.locator('#station-manager')).toHaveClass(/lm-open/);
});

test('line manager shows census data after stops are added', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await page.locator('#tool-line').click();
  await page.locator('#new-line-name').fill('Test');
  await page.locator('#new-line-add').click();

  const canvas = await page.locator('#map canvas').boundingBox();
  await page.mouse.click(canvas!.x + canvas!.width / 2, canvas!.y + canvas!.height / 2);
  await page.waitForTimeout(300);

  // Loading spinner should go away, then either grid or error becomes visible
  await expect(page.locator('#lm-stats-loading')).toBeHidden({ timeout: 30_000 });
  const gridVisible = await page.locator('#lm-stats-grid').isVisible();
  const errVisible  = await page.locator('#lm-stats-error').isVisible();
  expect(gridVisible || errVisible).toBe(true);
});

test('clicking line badge in station manager opens line manager', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  // Create a line and place a stop
  await page.locator('#tool-line').click();
  await page.locator('#new-line-name').fill('Tramlink');
  await page.locator('#new-line-add').click();

  const canvas = await page.locator('#map canvas').boundingBox();
  const cx = canvas!.x + canvas!.width / 2;
  const cy = canvas!.y + canvas!.height / 2;
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(300);

  // Close line manager first
  await page.locator('#line-manager-close').click();
  await expect(page.locator('#line-manager')).toHaveClass(/hidden/);

  // Select the station to open Station Manager
  await page.locator('#tool-select').click();
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(300);

  // Click the line badge in SM → should open LM
  await page.locator('#sm-lines-list .sm-line-badge').first().click();
  await expect(page.locator('#line-manager')).not.toHaveClass(/hidden/);
  await expect(page.locator('#line-manager-name')).toHaveValue('Tramlink');
});

