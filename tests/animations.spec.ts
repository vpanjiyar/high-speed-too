import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:5174';

async function waitForMap(page: import('@playwright/test').Page) {
  await page.waitForFunction(
    () => (window as unknown as Record<string, unknown>)['__mapState'] === 'loaded',
    { timeout: 20_000 },
  );
}

async function waitForMotion(
  page: import('@playwright/test').Page,
  selector: string,
  state: 'entering' | 'exiting',
) {
  await page.waitForFunction(
    ([targetSelector, expectedState]) => {
      const element = document.querySelector(targetSelector);
      if (!(element instanceof HTMLElement)) return false;

      const settledState = expectedState === 'entering' ? 'open' : 'closed';
      const currentState = element.dataset.motionState;
      return currentState === settledState
        || (currentState === expectedState && element.getAnimations().length > 0);
    },
    [selector, state],
  );
}

async function expectNoHorizontalOverflow(
  page: import('@playwright/test').Page,
  selector: string,
) {
  const metrics = await page.locator(selector).evaluate((element) => {
    if (!(element instanceof HTMLElement)) {
      return { clientWidth: 0, scrollWidth: 0 };
    }

    return {
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    };
  });

  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
}

async function dragResizeHandle(
  page: import('@playwright/test').Page,
  selector: string,
  deltaX: number,
  deltaY: number,
) {
  const box = await page.locator(selector).boundingBox();
  expect(box).not.toBeNull();

  const startX = box!.x + (box!.width / 2);
  const startY = box!.y + (box!.height / 2);

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + deltaX, startY + deltaY, { steps: 10 });
  await page.mouse.up();
}

async function seedLongNamedLine(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const editor = (window as unknown as {
      __networkEditor: {
        clearNetwork: () => void;
        createLine: (name: string, color: string, snapToExisting?: boolean) => void;
        setActiveLine: (lineId: string) => void;
        network: {
          lines: Array<{ id: string }>;
          addStation: (lng: number, lat: number, name: string) => { id: string };
          addStationToLine: (lineId: string, stationId: string) => void;
        };
      };
    }).__networkEditor;

    editor.clearNetwork();
    editor.createLine('Overflow Probe', '#E53935');
    const lineId = editor.network.lines[0]?.id;
    if (!lineId) return;

    const names = [
      'Very Long Station Name That Could Force Layout Issues Alpha',
      'Very Long Station Name That Could Force Layout Issues Beta',
      'Very Long Station Name That Could Force Layout Issues Gamma',
    ];
    const coords: Array<[number, number]> = [
      [-0.1, 51.5],
      [-0.08, 51.52],
      [-0.06, 51.54],
    ];

    names.forEach((name, index) => {
      const station = editor.network.addStation(coords[index][0], coords[index][1], name);
      editor.network.addStationToLine(lineId, station.id);
    });

    editor.setActiveLine(lineId);
  });

  await page.waitForTimeout(150);
}

async function seedLine(page: import('@playwright/test').Page, lineName = 'Animated Line') {
  await page.locator('#tool-line').click();
  await page.locator('#new-line-name').fill(lineName);
  await page.locator('#new-line-add').click();

  const canvas = await page.locator('#map canvas').boundingBox();
  expect(canvas).not.toBeNull();
  const cx = canvas!.x + canvas!.width / 2;
  const cy = canvas!.y + canvas!.height / 2;

  await page.mouse.click(cx - 60, cy);
  await page.mouse.click(cx + 60, cy);
  await page.waitForTimeout(250);
}

async function seedDemandLine(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const editor = (window as unknown as {
      __networkEditor: {
        clearNetwork: () => void;
        createLine: (name: string, color: string, snapToExisting?: boolean) => void;
        setActiveLine: (lineId: string) => void;
        network: {
          lines: Array<{ id: string }>;
          addStation: (lng: number, lat: number, name: string) => { id: string };
          addStationToLine: (lineId: string, stationId: string) => void;
          setLineTrain: (lineId: string, rollingStockId: string, trainCount?: number) => void;
        };
      };
    }).__networkEditor;

    editor.clearNetwork();
    editor.createLine('Demand Test', '#1E88E5');
    const lineId = editor.network.lines[0]?.id;
    if (!lineId) return;

    const stations: Array<[number, number, string]> = [
      [-0.141, 51.501, 'Victoria'],
      [-0.124, 51.503, 'Westminster'],
      [-0.104, 51.505, 'Blackfriars'],
    ];

    stations.forEach(([lng, lat, name]) => {
      const station = editor.network.addStation(lng, lat, name);
      editor.network.addStationToLine(lineId, station.id);
    });

    editor.network.setLineTrain(lineId, 'class-700', 6);
    editor.setActiveLine(lineId);
  });

  await page.waitForTimeout(250);
}

function buildImportJson(): Buffer {
  return Buffer.from(JSON.stringify({
    appId: 'high-speed-too',
    version: 1,
    exportedAt: new Date().toISOString(),
    network: {
      stations: [
        { id: 'import_station_1', name: 'Import One', lng: -0.1, lat: 51.5 },
        { id: 'import_station_2', name: 'Import Two', lng: -0.08, lat: 51.52 },
      ],
      lines: [
        {
          id: 'import_line_1',
          name: 'Import Line',
          color: '#E53935',
          stationIds: ['import_station_1', 'import_station_2'],
        },
      ],
    },
  }));
}

test('line panel open and close are animated', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await page.locator('#tool-line').click();
  await waitForMotion(page, '#line-panel', 'entering');
  await expect(page.locator('#line-panel')).toBeVisible();

  await page.locator('#line-panel-close').click();
  await waitForMotion(page, '#line-panel', 'exiting');
  await expect(page.locator('#line-panel')).toBeHidden();
});

test('station manager drawer open and close are animated', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await page.locator('#tool-station').click();
  const canvas = await page.locator('#map canvas').boundingBox();
  expect(canvas).not.toBeNull();
  await page.mouse.click(canvas!.x + canvas!.width / 2, canvas!.y + canvas!.height / 2);
  await page.waitForTimeout(200);

  await page.evaluate(() => {
    const editor = (window as unknown as {
      __networkEditor: {
        network: { stations: Array<{ id: string }> };
        selectStation: (stationId: string) => void;
      };
    }).__networkEditor;
    editor.selectStation(editor.network.stations[0].id);
  });

  await waitForMotion(page, '#station-manager', 'entering');
  await expect(page.locator('#station-manager')).toBeVisible();

  await page.locator('#station-manager-close').click();
  await waitForMotion(page, '#station-manager', 'exiting');
  await expect(page.locator('#station-manager')).toBeHidden();
});

test('line manager and train picker modal animate in and out', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);
  await seedLine(page);

  await expect(page.locator('#line-manager')).toBeVisible();

  await page.locator('#line-manager-close').click();
  await waitForMotion(page, '#line-manager', 'exiting');
  await expect(page.locator('#line-manager')).toBeHidden();

  await page.locator('.line-item').first().click();
  await waitForMotion(page, '#line-manager', 'entering');
  await expect(page.locator('#line-manager')).toBeVisible();

  await page.locator('#lm-train-pick').click();
  await waitForMotion(page, '#train-picker-modal', 'entering');
  await expect(page.locator('#train-picker-modal')).toBeVisible();

  await page.locator('#train-picker-cancel').click();
  await waitForMotion(page, '#train-picker-modal', 'exiting');
  await expect(page.locator('#train-picker-modal')).toBeHidden();

  await page.locator('#line-manager-close').click();
  await waitForMotion(page, '#line-manager', 'exiting');
  await expect(page.locator('#line-manager')).toBeHidden();
});

test('line manager stays free of horizontal overflow', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);
  await seedLongNamedLine(page);

  await expect(page.locator('#line-manager')).toBeVisible();
  await page.locator('.lm-stop-handle').first().hover();

  await expectNoHorizontalOverflow(page, '#line-manager');
  await expectNoHorizontalOverflow(page, '#line-manager-body');

  const documentMetrics = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(documentMetrics.scrollWidth).toBeLessThanOrEqual(documentMetrics.innerWidth + 1);
});

test('floating panels resize from their corner handle without losing readability', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await page.locator('#tool-line').click();
  await waitForMotion(page, '#line-panel', 'entering');

  const before = await page.locator('#line-panel').boundingBox();
  expect(before).not.toBeNull();

  await dragResizeHandle(page, '#line-panel .panel-resize-handle', 96, 88);
  await page.waitForTimeout(120);

  const after = await page.locator('#line-panel').boundingBox();
  expect(after).not.toBeNull();
  expect(after!.width).toBeGreaterThan(before!.width + 60);
  expect(after!.height).toBeGreaterThan(before!.height + 50);
  await expectNoHorizontalOverflow(page, '#line-panel');
});

test('station manager stays clear of a resized line manager drawer', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);
  await seedLine(page, 'Resizable Drawer');

  await page.locator('.lm-stop-item').first().click();
  await waitForMotion(page, '#station-manager', 'entering');
  await expect(page.locator('#station-manager')).toBeVisible();

  const before = await page.locator('#line-manager').boundingBox();
  expect(before).not.toBeNull();

  await dragResizeHandle(page, '#line-manager .panel-resize-handle', -110, 0);
  await page.waitForTimeout(120);

  const layout = await page.evaluate(() => {
    const lineManager = document.getElementById('line-manager');
    const stationManager = document.getElementById('station-manager');
    if (!(lineManager instanceof HTMLElement) || !(stationManager instanceof HTMLElement)) {
      return null;
    }

    const lineBox = lineManager.getBoundingClientRect();
    const stationBox = stationManager.getBoundingClientRect();
    return {
      lineWidth: lineBox.width,
      stationRight: stationBox.right,
      lineLeft: lineBox.left,
    };
  });

  expect(layout).not.toBeNull();
  expect(layout!.lineWidth).toBeGreaterThan(before!.width + 80);
  expect(layout!.stationRight).toBeLessThanOrEqual(layout!.lineLeft + 1);
  await expectNoHorizontalOverflow(page, '#line-manager');
  await expectNoHorizontalOverflow(page, '#station-manager');
});

test('mobile managers become resizable bottom sheets', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE);
  await waitForMap(page);
  await seedLine(page, 'Mobile Drawer');

  const before = await page.locator('#line-manager').boundingBox();
  expect(before).not.toBeNull();
  expect(before!.width).toBeGreaterThan(340);
  expect(before!.y).toBeGreaterThan(200);

  await dragResizeHandle(page, '#line-manager .panel-resize-handle', 0, -120);
  await page.waitForTimeout(120);

  const after = await page.locator('#line-manager').boundingBox();
  expect(after).not.toBeNull();
  expect(after!.height).toBeGreaterThan(before!.height + 80);

  await page.locator('.lm-stop-item').first().click();
  await waitForMotion(page, '#station-manager', 'entering');

  const stationBox = await page.locator('#station-manager').boundingBox();
  const lineBox = await page.locator('#line-manager').boundingBox();
  expect(stationBox).not.toBeNull();
  expect(lineBox).not.toBeNull();
  expect(stationBox!.y + stationBox!.height).toBeLessThanOrEqual(lineBox!.y + 1);

  const documentMetrics = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(documentMetrics.scrollWidth).toBeLessThanOrEqual(documentMetrics.innerWidth + 1);
});

test('journey profile modal animates after choosing rolling stock', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);
  await seedLine(page);

  await page.locator('#lm-train-pick').click();
  await waitForMotion(page, '#train-picker-modal', 'entering');
  await page.locator('.train-picker-item').first().click();
  await waitForMotion(page, '#train-picker-modal', 'exiting');

  await expect(page.locator('#lm-open-journey-profile')).toBeVisible();
  await page.locator('#lm-open-journey-profile').click();
  await waitForMotion(page, '#journey-profile-modal', 'entering');
  await expect(page.locator('#journey-profile-modal')).toBeVisible();

  await page.locator('#journey-profile-dismiss').click();
  await waitForMotion(page, '#journey-profile-modal', 'exiting');
  await expect(page.locator('#journey-profile-modal')).toBeHidden();
});

test('line popularity modal animates after census-backed demand is available', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);
  await seedDemandLine(page);

  await expect(page.locator('#lm-stats-loading')).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('#lm-open-demand-model')).toBeEnabled({ timeout: 30_000 });

  await page.locator('#lm-open-demand-model').click();
  await waitForMotion(page, '#line-demand-modal', 'entering');
  await expect(page.locator('#line-demand-modal')).toBeVisible();

  await page.locator('#line-demand-dismiss').click();
  await waitForMotion(page, '#line-demand-modal', 'exiting');
  await expect(page.locator('#line-demand-modal')).toBeHidden();
});

test('export modal and step transition are animated', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);
  await seedLine(page);

  await page.locator('#btn-export').click();
  await waitForMotion(page, '#export-modal', 'entering');
  await expect(page.locator('#export-modal')).toBeVisible();

  await page.locator('#export-btn-next').click();
  await waitForMotion(page, '#export-step-lines', 'exiting');
  await waitForMotion(page, '#export-step-style', 'entering');
  await expect(page.locator('#export-step-style')).toBeVisible();

  await page.locator('#export-btn-back').click();
  await waitForMotion(page, '#export-step-style', 'exiting');
  await waitForMotion(page, '#export-step-lines', 'entering');
  await expect(page.locator('#export-step-lines')).toBeVisible();

  await page.locator('#export-btn-cancel').click();
  await waitForMotion(page, '#export-modal', 'exiting');
  await expect(page.locator('#export-modal')).toBeHidden();
});

test('import conflict modal open and close are animated', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);
  await seedLine(page);

  await page.locator('#import-file-input').setInputFiles({
    name: 'animated-import.json',
    mimeType: 'application/json',
    buffer: buildImportJson(),
  });

  await waitForMotion(page, '#import-modal', 'entering');
  await expect(page.locator('#import-modal')).toBeVisible();

  await page.locator('#import-btn-cancel').click();
  await waitForMotion(page, '#import-modal', 'exiting');
  await expect(page.locator('#import-modal')).toBeHidden();
});

test('census legend animates when a metric is toggled on and off', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await page.locator('label.census-radio').filter({ has: page.locator('input[value="population"]') }).click();
  await waitForMotion(page, '#census-legend', 'entering');
  await expect(page.locator('#census-legend')).toBeVisible();

  await page.locator('label.census-radio').filter({ has: page.locator('input[value="off"]') }).click();
  await waitForMotion(page, '#census-legend', 'exiting');
  await expect(page.locator('#census-legend')).toBeHidden();
});

