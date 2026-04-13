// ── Export tests ────────────────────────────────────────────────────────────────
// Validates the transit map export feature: modal flow, line selection,
// style selection, legend toggle, and the generated export page.

import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:5174';

type ExportDebug = {
  header: 'route-bullets' | 'roundel' | 'metro-placard';
  decorationKinds: string[];
  brandingText: string;
  fontStack: string;
  routeBullets: Array<{ lineId: string; bullet: string }>;
  stationSymbols: Array<{ symbol: string; lineCount: number }>;
  segmentAngles: Array<{ lineId: string; allOctilinear: boolean }>;
  allOctilinear: boolean;
  labelCollisions: boolean;
  parallelSharedSegments: Array<{
    key: string;
    lineIds: string[];
    laneOffsets: Array<{ lineId: string; offset: number }>;
  }>;
};

async function waitForMap(page: import('@playwright/test').Page) {
  await page.waitForFunction(
    () => {
      const w = window as unknown as Record<string, unknown>;
      return !!w['__map'] && !!w['__networkEditor'];
    },
    { timeout: 20_000 },
  );
}

/** Seed the map with one line and two stations so there is data to export. */
async function seedNetwork(page: import('@playwright/test').Page) {
  await page.locator('#tool-line').click();
  await expect(page.locator('#line-panel')).toBeVisible({ timeout: 10_000 });
  await page.locator('#new-line-name').fill('Test Line');
  await page.locator('#new-line-add').click();

  const canvas = await page.locator('#map canvas').boundingBox();
  const cx = canvas!.x + canvas!.width / 2;
  const cy = canvas!.y + canvas!.height / 2;
  await page.mouse.click(cx - 50, cy);
  await page.mouse.click(cx + 50, cy);
  await page.waitForTimeout(100);
}

/** Seed the map with two lines sharing a station (interchange). */
async function seedTwoLines(page: import('@playwright/test').Page) {
  await page.locator('#tool-line').click();
  await expect(page.locator('#line-panel')).toBeVisible({ timeout: 10_000 });
  await page.locator('#new-line-name').fill('Red Line');
  await page.locator('#new-line-add').click();

  const canvas = await page.locator('#map canvas').boundingBox();
  const cx = canvas!.x + canvas!.width / 2;
  const cy = canvas!.y + canvas!.height / 2;
  // Red line: left → centre → right
  await page.mouse.click(cx - 80, cy);
  await page.mouse.click(cx, cy);
  await page.mouse.click(cx + 80, cy);
  await page.waitForTimeout(100);

  // Create a second line
  await page.locator('#new-line-name').fill('Blue Line');
  await page.locator('#new-line-add').click();

  // Blue line: top → centre (same station) → bottom
  await page.mouse.click(cx, cy - 60);
  await page.mouse.click(cx, cy + 60);
  await page.waitForTimeout(100);
}

async function seedDeterministicInterchangeNetwork(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const network = (window as unknown as {
      __networkEditor: {
        network: {
          addLine: (name: string, color: string) => { id: string };
          addStation: (lng: number, lat: number, name: string) => { id: string };
          addStationToLine: (lineId: string, stationId: string) => void;
        };
      };
    }).__networkEditor.network;

    const central = network.addLine('Central', '#DC241F');
    const victoria = network.addLine('Victoria', '#00A0E2');

    const westEnd = network.addStation(-0.155, 51.515, 'West End');
    const oxford = network.addStation(-0.141, 51.515, 'Oxford Circus');
    const holborn = network.addStation(-0.119, 51.517, 'Holborn');
    const bank = network.addStation(-0.091, 51.513, 'Bank');
    const kingsCross = network.addStation(-0.123, 51.531, 'King\'s Cross');
    const greenPark = network.addStation(-0.142, 51.506, 'Green Park');
    const brixton = network.addStation(-0.115, 51.462, 'Brixton');

    network.addStationToLine(central.id, westEnd.id);
    network.addStationToLine(central.id, oxford.id);
    network.addStationToLine(central.id, holborn.id);
    network.addStationToLine(central.id, bank.id);

    network.addStationToLine(victoria.id, kingsCross.id);
    network.addStationToLine(victoria.id, oxford.id);
    network.addStationToLine(victoria.id, greenPark.id);
    network.addStationToLine(victoria.id, brixton.id);
  });

  await page.waitForTimeout(120);
}

async function seedSharedTrunkNetwork(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const network = (window as unknown as {
      __networkEditor: {
        network: {
          addLine: (name: string, color: string) => { id: string };
          addStation: (lng: number, lat: number, name: string) => { id: string };
          addStationToLine: (lineId: string, stationId: string) => void;
        };
      };
    }).__networkEditor.network;

    const amber = network.addLine('Amber', '#F59E0B');
    const teal = network.addLine('Teal', '#00A0E2');

    const west = network.addStation(-0.172, 51.514, 'West');
    const central = network.addStation(-0.145, 51.514, 'Central');
    const east = network.addStation(-0.118, 51.514, 'East');
    const riverside = network.addStation(-0.091, 51.514, 'Riverside');
    const north = network.addStation(-0.145, 51.536, 'North');
    const south = network.addStation(-0.118, 51.492, 'South');

    network.addStationToLine(amber.id, west.id);
    network.addStationToLine(amber.id, central.id);
    network.addStationToLine(amber.id, east.id);
    network.addStationToLine(amber.id, riverside.id);

    network.addStationToLine(teal.id, north.id);
    network.addStationToLine(teal.id, central.id);
    network.addStationToLine(teal.id, east.id);
    network.addStationToLine(teal.id, south.id);
  });

  await page.waitForTimeout(120);
}

async function openExportPageFor(
  page: import('@playwright/test').Page,
  context: import('@playwright/test').BrowserContext,
  style: 'mta' | 'lu' | 'paris' = 'mta',
) {
  await page.locator('#btn-export').click();
  await page.locator('#export-btn-next').click();

  if (style !== 'mta') {
    await page.locator(`input[name="export-style"][value="${style}"]`).check();
  }

  const [exportPage] = await Promise.all([
    context.waitForEvent('page'),
    page.locator('#export-btn-export').click(),
  ]);

  await exportPage.waitForLoadState('domcontentloaded');
  return exportPage;
}

async function getExportDebug(page: import('@playwright/test').Page): Promise<ExportDebug> {
  return page.evaluate(() => (window as unknown as { __EXPORT_DEBUG__: ExportDebug }).__EXPORT_DEBUG__);
}

async function waitForPreviewDebug(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForFunction(() => {
    const frame = document.getElementById('export-preview-frame') as HTMLIFrameElement | null;
    return Boolean(frame?.contentWindow && (frame.contentWindow as Window & { __EXPORT_DEBUG__?: unknown }).__EXPORT_DEBUG__);
  });
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

async function getPreviewDebug(page: import('@playwright/test').Page): Promise<ExportDebug> {
  await waitForPreviewDebug(page);
  return page.evaluate(() => {
    const frame = document.getElementById('export-preview-frame') as HTMLIFrameElement;
    return (frame.contentWindow as Window & { __EXPORT_DEBUG__: ExportDebug }).__EXPORT_DEBUG__;
  });
}

async function waitForPreviewHeader(
  page: import('@playwright/test').Page,
  header: ExportDebug['header'],
): Promise<ExportDebug> {
  await page.waitForFunction((expectedHeader) => {
    const frame = document.getElementById('export-preview-frame') as HTMLIFrameElement | null;
    return (frame?.contentWindow as Window & { __EXPORT_DEBUG__?: ExportDebug } | null)?.__EXPORT_DEBUG__?.header === expectedHeader;
  }, header);
  return getPreviewDebug(page);
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

async function sampleCanvasPixel(
  page: import('@playwright/test').Page,
  x: number,
  y: number,
): Promise<[number, number, number, number]> {
  return page.evaluate(([px, py]) => {
    const canvas = document.getElementById('export-canvas') as HTMLCanvasElement;
    const data = canvas.getContext('2d')!.getImageData(px, py, 1, 1).data;
    return [data[0], data[1], data[2], data[3]] as [number, number, number, number];
  }, [x, y]);
}

function expectPixelApprox(
  pixel: [number, number, number, number],
  expected: [number, number, number],
  tolerance = 26,
) {
  expect(Math.abs(pixel[0] - expected[0])).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(pixel[1] - expected[1])).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(pixel[2] - expected[2])).toBeLessThanOrEqual(tolerance);
  expect(pixel[3]).toBeGreaterThan(0);
}

// ── UI presence ────────────────────────────────────────────────────────────────

test('export button is visible in the history controls panel', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);
  await expect(page.locator('#btn-export')).toBeVisible();
});

test('export button is after save/import with a separator', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  const container = page.locator('#history-controls');
  await expect(container.locator('#btn-save')).toBeVisible();
  await expect(container.locator('#btn-import')).toBeVisible();
  await expect(container.locator('#btn-export')).toBeVisible();

  // The separator before export button exists
  const separators = container.locator('.history-sep');
  const count = await separators.count();
  expect(count).toBeGreaterThanOrEqual(2); // one between undo/redo and save, one before export
});

// ── Export modal — no lines ─────────────────────────────────────────────────

test('export modal shows "no lines" message when network is empty', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await page.locator('#btn-export').click();
  await expect(page.locator('#export-modal')).toBeVisible();
  await expect(page.locator('#export-no-lines')).toBeVisible();
  await expect(page.locator('#export-no-lines')).toContainText('create at least one line');
});

test('next button is hidden when no lines exist', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await page.locator('#btn-export').click();
  await expect(page.locator('#export-btn-next')).toBeHidden();
});

// ── Export modal — line selection ────────────────────────────────────────────

test('export modal lists all user-created lines', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);
  await seedNetwork(page);

  await page.locator('#btn-export').click();
  await expect(page.locator('#export-modal')).toBeVisible();
  await expect(page.locator('#export-no-lines')).toBeHidden();

  // Should have one line item with checkbox
  const items = page.locator('.export-line-item');
  await expect(items).toHaveCount(1);
  await expect(items.first()).toContainText('Test Line');
});

test('export line items are checked by default', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);
  await seedNetwork(page);

  await page.locator('#btn-export').click();

  const checkbox = page.locator('.export-line-item input[type="checkbox"]').first();
  await expect(checkbox).toBeChecked();
});

test('export shows line color and stop count', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);
  await seedNetwork(page);

  await page.locator('#btn-export').click();

  const item = page.locator('.export-line-item').first();
  await expect(item.locator('.export-line-dot')).toBeVisible();
  await expect(item.locator('.export-line-stops')).toContainText('stops');
});

test('export modal avoids horizontal overflow and stays within the viewport', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);
  await seedNetwork(page);

  await page.locator('#btn-export').click();
  await expect(page.locator('#export-modal')).toBeVisible();
  await page.locator('.export-line-item').first().hover();

  await expectNoHorizontalOverflow(page, '#export-line-list');

  await page.locator('#export-btn-next').click();
  await waitForPreviewDebug(page);

  await expectNoHorizontalOverflow(page, '.export-modal-box');
  await expectNoHorizontalOverflow(page, '.export-style-layout');

  const viewportFit = await page.evaluate(() => {
    const modal = document.querySelector('.export-modal-box');
    if (!(modal instanceof HTMLElement)) {
      return null;
    }

    const rect = modal.getBoundingClientRect();
    return {
      top: rect.top,
      bottom: rect.bottom,
      innerHeight: window.innerHeight,
      innerWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    };
  });

  expect(viewportFit).not.toBeNull();
  expect(viewportFit!.top).toBeGreaterThanOrEqual(0);
  expect(viewportFit!.bottom).toBeLessThanOrEqual(viewportFit!.innerHeight);
  expect(viewportFit!.scrollWidth).toBeLessThanOrEqual(viewportFit!.innerWidth + 1);
});

test('next button requires at least one line selected', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);
  await seedNetwork(page);

  await page.locator('#btn-export').click();

  // Uncheck all lines
  const checkbox = page.locator('.export-line-item input[type="checkbox"]').first();
  await checkbox.uncheck();

  // Mock alert
  let alertMsg = '';
  page.on('dialog', async (dialog) => {
    alertMsg = dialog.message();
    await dialog.accept();
  });

  await page.locator('#export-btn-next').click();
  expect(alertMsg).toContain('at least one line');

  // Modal should still be visible (didn't advance)
  await expect(page.locator('#export-step-lines')).toBeVisible();
});

// ── Export modal — style selection ──────────────────────────────────────────

test('clicking next shows style selection step', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);
  await seedNetwork(page);

  await page.locator('#btn-export').click();
  await page.locator('#export-btn-next').click();
  await waitForMotion(page, '#export-step-lines', 'exiting');
  await waitForMotion(page, '#export-step-style', 'entering');

  // Lines step should be hidden, style step visible
  await expect(page.locator('#export-step-lines')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('#export-step-style')).toHaveAttribute('aria-hidden', 'false');
});

test('MTA style is selected by default', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);
  await seedNetwork(page);

  await page.locator('#btn-export').click();
  await page.locator('#export-btn-next').click();

  const mtaRadio = page.locator('input[name="export-style"][value="mta"]');
  await expect(mtaRadio).toBeChecked();
});

test('can select London Underground style', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);
  await seedNetwork(page);

  await page.locator('#btn-export').click();
  await page.locator('#export-btn-next').click();

  await page.locator('input[name="export-style"][value="lu"]').check();
  const luRadio = page.locator('input[name="export-style"][value="lu"]');
  await expect(luRadio).toBeChecked();
});

test('can select Paris Metro style', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);
  await seedNetwork(page);

  await page.locator('#btn-export').click();
  await page.locator('#export-btn-next').click();

  await page.locator('input[name="export-style"][value="paris"]').check();
  await expect(page.locator('input[name="export-style"][value="paris"]')).toBeChecked();
});

test('unfinished export styles are marked as WIP', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);
  await seedNetwork(page);

  await page.locator('#btn-export').click();
  await page.locator('#export-btn-next').click();

  const mtaOption = page.locator('.export-style-option').filter({
    has: page.locator('input[name="export-style"][value="mta"]'),
  });
  const luOption = page.locator('.export-style-option').filter({
    has: page.locator('input[name="export-style"][value="lu"]'),
  });
  const parisOption = page.locator('.export-style-option').filter({
    has: page.locator('input[name="export-style"][value="paris"]'),
  });

  await expect(mtaOption.locator('.export-style-tag')).toHaveText('WIP');
  await expect(parisOption.locator('.export-style-tag')).toHaveText('WIP');
  await expect(luOption.locator('.export-style-tag')).toHaveCount(0);
});

test('legend checkbox is shown and checked by default', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);
  await seedNetwork(page);

  await page.locator('#btn-export').click();
  await page.locator('#export-btn-next').click();

  const legendCb = page.locator('#export-show-legend');
  await expect(legendCb).toBeVisible();
  await expect(legendCb).toBeChecked();
});

test('legend checkbox can be unchecked', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);
  await seedNetwork(page);

  await page.locator('#btn-export').click();
  await page.locator('#export-btn-next').click();

  await page.locator('#export-show-legend').uncheck();
  await expect(page.locator('#export-show-legend')).not.toBeChecked();
});

test('style step shows a live preview and updates when the style changes', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);
  await seedDeterministicInterchangeNetwork(page);

  await page.locator('#btn-export').click();
  await page.locator('#export-btn-next').click();

  await expect(page.locator('#export-preview-frame')).toBeVisible();
  let previewDebug = await waitForPreviewHeader(page, 'route-bullets');
  expect(previewDebug.header).toBe('route-bullets');

  await page.locator('input[name="export-style"][value="lu"]').check();
  previewDebug = await waitForPreviewHeader(page, 'roundel');
  expect(previewDebug.header).toBe('roundel');

  await page.locator('input[name="export-style"][value="paris"]').check();
  previewDebug = await waitForPreviewHeader(page, 'metro-placard');
  expect(previewDebug.header).toBe('metro-placard');
});

// ── Export modal — navigation ───────────────────────────────────────────────

test('back button returns to line selection step', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);
  await seedNetwork(page);

  await page.locator('#btn-export').click();
  await page.locator('#export-btn-next').click();
  await waitForMotion(page, '#export-step-style', 'entering');
  await expect(page.locator('#export-step-style')).toBeVisible();

  await page.locator('#export-btn-back').click();
  await waitForMotion(page, '#export-step-style', 'exiting');
  await waitForMotion(page, '#export-step-lines', 'entering');
  await expect(page.locator('#export-step-lines')).toHaveAttribute('aria-hidden', 'false');
  await expect(page.locator('#export-step-style')).toHaveAttribute('aria-hidden', 'true');
});

test('cancel button closes the export modal', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);
  await seedNetwork(page);

  await page.locator('#btn-export').click();
  await expect(page.locator('#export-modal')).toBeVisible();

  await page.locator('#export-btn-cancel').click();
  await expect(page.locator('#export-modal')).toBeHidden();
});

test('clicking backdrop closes the export modal', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);
  await seedNetwork(page);

  await page.locator('#btn-export').click();
  await expect(page.locator('#export-modal')).toBeVisible();

  // Click on the backdrop (the modal-backdrop element itself, not the inner box)
  await page.locator('#export-modal').click({ position: { x: 5, y: 5 } });
  await expect(page.locator('#export-modal')).toBeHidden();
});

// ── Export page generation ──────────────────────────────────────────────────

test('export button opens a new page with MTA style', async ({ page, context }) => {
  await page.goto(BASE);
  await waitForMap(page);
  await seedNetwork(page);

  await page.locator('#btn-export').click();
  await page.locator('#export-btn-next').click();

  // MTA style is already selected by default
  const [exportPage] = await Promise.all([
    context.waitForEvent('page'),
    page.locator('#export-btn-export').click(),
  ]);

  await exportPage.waitForLoadState('domcontentloaded');

  // Canvas should be present
  const canvas = exportPage.locator('#export-canvas');
  await expect(canvas).toBeVisible();

  // Download and close buttons should be present
  await expect(exportPage.locator('#btn-download')).toBeVisible();
  await expect(exportPage.locator('#btn-close')).toBeVisible();

  await exportPage.close();
});

test('export button opens a new page with LU style', async ({ page, context }) => {
  await page.goto(BASE);
  await waitForMap(page);
  await seedNetwork(page);

  await page.locator('#btn-export').click();
  await page.locator('#export-btn-next').click();

  await page.locator('input[name="export-style"][value="lu"]').check();

  const [exportPage] = await Promise.all([
    context.waitForEvent('page'),
    page.locator('#export-btn-export').click(),
  ]);

  await exportPage.waitForLoadState('domcontentloaded');

  const canvas = exportPage.locator('#export-canvas');
  await expect(canvas).toBeVisible();

  await exportPage.close();
});

test('export button opens a new page with Paris style', async ({ page, context }) => {
  await page.goto(BASE);
  await waitForMap(page);
  await seedNetwork(page);

  const exportPage = await openExportPageFor(page, context, 'paris');
  await expect(exportPage.locator('#export-canvas')).toBeVisible();
  await exportPage.close();
});

test('export page has the correct canvas dimensions', async ({ page, context }) => {
  await page.goto(BASE);
  await waitForMap(page);
  await seedNetwork(page);

  await page.locator('#btn-export').click();
  await page.locator('#export-btn-next').click();

  const [exportPage] = await Promise.all([
    context.waitForEvent('page'),
    page.locator('#export-btn-export').click(),
  ]);

  await exportPage.waitForLoadState('domcontentloaded');

  const dims = await exportPage.evaluate(() => {
    const c = document.getElementById('export-canvas') as HTMLCanvasElement;
    return { width: c.width, height: c.height };
  });

  expect(dims.width).toBe(1400);
  expect(dims.height).toBe(900);

  await exportPage.close();
});

test('export page title contains "Transit Map Export"', async ({ page, context }) => {
  await page.goto(BASE);
  await waitForMap(page);
  await seedNetwork(page);

  await page.locator('#btn-export').click();
  await page.locator('#export-btn-next').click();

  const [exportPage] = await Promise.all([
    context.waitForEvent('page'),
    page.locator('#export-btn-export').click(),
  ]);

  await exportPage.waitForLoadState('domcontentloaded');
  await expect(exportPage).toHaveTitle(/Transit Map Export/);

  await exportPage.close();
});

// ── Export page — Download PNG ──────────────────────────────────────────────

test('download button triggers PNG file download', async ({ page, context }) => {
  await page.goto(BASE);
  await waitForMap(page);
  await seedNetwork(page);

  await page.locator('#btn-export').click();
  await page.locator('#export-btn-next').click();

  const [exportPage] = await Promise.all([
    context.waitForEvent('page'),
    page.locator('#export-btn-export').click(),
  ]);

  await exportPage.waitForLoadState('domcontentloaded');

  const [download] = await Promise.all([
    exportPage.waitForEvent('download'),
    exportPage.locator('#btn-download').click(),
  ]);

  expect(download.suggestedFilename()).toMatch(/transit-map-mta\.png/);

  await exportPage.close();
});

test('LU export downloads file with lu in filename', async ({ page, context }) => {
  await page.goto(BASE);
  await waitForMap(page);
  await seedNetwork(page);

  await page.locator('#btn-export').click();
  await page.locator('#export-btn-next').click();
  await page.locator('input[name="export-style"][value="lu"]').check();

  const [exportPage] = await Promise.all([
    context.waitForEvent('page'),
    page.locator('#export-btn-export').click(),
  ]);

  await exportPage.waitForLoadState('domcontentloaded');

  const [download] = await Promise.all([
    exportPage.waitForEvent('download'),
    exportPage.locator('#btn-download').click(),
  ]);

  expect(download.suggestedFilename()).toMatch(/transit-map-lu\.png/);

  await exportPage.close();
});

test('Paris export downloads file with paris in filename', async ({ page, context }) => {
  await page.goto(BASE);
  await waitForMap(page);
  await seedNetwork(page);

  const exportPage = await openExportPageFor(page, context, 'paris');

  const [download] = await Promise.all([
    exportPage.waitForEvent('download'),
    exportPage.locator('#btn-download').click(),
  ]);

  expect(download.suggestedFilename()).toMatch(/transit-map-paris\.png/);

  await exportPage.close();
});

// ── Export modal closes after export ─────────────────────────────────────────

test('export modal closes after clicking export', async ({ page, context }) => {
  await page.goto(BASE);
  await waitForMap(page);
  await seedNetwork(page);

  await page.locator('#btn-export').click();
  await page.locator('#export-btn-next').click();

  const [exportPage] = await Promise.all([
    context.waitForEvent('page'),
    page.locator('#export-btn-export').click(),
  ]);

  await exportPage.waitForLoadState('domcontentloaded');

  // Original page modal should be closed
  await expect(page.locator('#export-modal')).toBeHidden();

  await exportPage.close();
});

// ── Multiple lines ──────────────────────────────────────────────────────────

test('export modal shows multiple lines when they exist', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);
  await seedTwoLines(page);

  await page.locator('#btn-export').click();

  const items = page.locator('.export-line-item');
  const count = await items.count();
  expect(count).toBeGreaterThanOrEqual(2);
});

test('can deselect specific lines for export', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);
  await seedTwoLines(page);

  await page.locator('#btn-export').click();

  // Uncheck the first line
  const firstCb = page.locator('.export-line-item input[type="checkbox"]').first();
  await firstCb.uncheck();
  await expect(firstCb).not.toBeChecked();

  // Second line should still be checked
  const secondCb = page.locator('.export-line-item input[type="checkbox"]').nth(1);
  await expect(secondCb).toBeChecked();
});

test('LU export uses octilinear routing and tube station symbols', async ({ page, context }) => {
  await page.goto(BASE);
  await waitForMap(page);
  await seedDeterministicInterchangeNetwork(page);

  const exportPage = await openExportPageFor(page, context, 'lu');
  const debug = await getExportDebug(exportPage);

  expect(debug.header).toBe('roundel');
  expect(debug.allOctilinear).toBe(true);
  expect(debug.segmentAngles.every((segment) => segment.allOctilinear)).toBe(true);
  expect(debug.decorationKinds).toContain('roundel');
  expect(debug.stationSymbols.some((station) => station.symbol === 'tick')).toBe(true);
  expect(debug.stationSymbols.some((station) => station.symbol === 'interchange')).toBe(true);
  expect(debug.labelCollisions).toBe(false);

  await exportPage.close();
});

test('LU export exposes High Speed Too branding and a Johnston-first font stack', async ({ page, context }) => {
  await page.goto(BASE);
  await waitForMap(page);
  await seedDeterministicInterchangeNetwork(page);

  const exportPage = await openExportPageFor(page, context, 'lu');
  const debug = await getExportDebug(exportPage);

  expect(debug.brandingText).toBe('HIGH SPEED TOO');
  expect(debug.fontStack).toContain('Johnston');

  await exportPage.close();
});

test('LU export offsets shared track segments into parallel lanes', async ({ page, context }) => {
  await page.goto(BASE);
  await waitForMap(page);
  await seedSharedTrunkNetwork(page);

  const exportPage = await openExportPageFor(page, context, 'lu');
  const debug = await getExportDebug(exportPage);
  const shared = debug.parallelSharedSegments.find((segment) => segment.lineIds.length === 2);

  expect(shared).toBeTruthy();
  expect(shared!.laneOffsets).toHaveLength(2);
  expect(shared!.laneOffsets.every((lane) => Math.abs(lane.offset) > 0.5)).toBe(true);
  expect(shared!.laneOffsets[0].offset).toBeCloseTo(-shared!.laneOffsets[1].offset, 5);
  expect(debug.allOctilinear).toBe(true);

  await exportPage.close();
});

test('LU export paints the roundel header in TfL blue and red', async ({ page, context }) => {
  await page.goto(BASE);
  await waitForMap(page);
  await seedDeterministicInterchangeNetwork(page);

  const exportPage = await openExportPageFor(page, context, 'lu');
  const bluePixel = await sampleCanvasPixel(exportPage, 76, 77);
  const redPixel = await sampleCanvasPixel(exportPage, 129, 47);

  expectPixelApprox(bluePixel, [0, 25, 168], 24);
  expectPixelApprox(redPixel, [220, 36, 31], 28);

  await exportPage.close();
});

test('MTA export exposes route bullets and paints a blue water band', async ({ page, context }) => {
  await page.goto(BASE);
  await waitForMap(page);
  await seedDeterministicInterchangeNetwork(page);

  const exportPage = await openExportPageFor(page, context, 'mta');
  const debug = await getExportDebug(exportPage);
  const waterPixel = await sampleCanvasPixel(exportPage, 120, 780);

  expect(debug.header).toBe('route-bullets');
  expect(debug.decorationKinds).toContain('water-band');
  expect(debug.routeBullets).toHaveLength(2);
  expect(debug.routeBullets.map((bullet) => bullet.bullet)).toEqual(['C', 'V']);
  expect(debug.stationSymbols.some((station) => station.symbol === 'dot')).toBe(true);
  expect(debug.stationSymbols.some((station) => station.symbol === 'interchange')).toBe(true);
  expect(debug.labelCollisions).toBe(false);
  expectPixelApprox(waterPixel, [191, 208, 225], 30);

  await exportPage.close();
});

test('Paris export exposes Metro placard styling and compact station symbols', async ({ page, context }) => {
  await page.goto(BASE);
  await waitForMap(page);
  await seedDeterministicInterchangeNetwork(page);

  const exportPage = await openExportPageFor(page, context, 'paris');
  const debug = await getExportDebug(exportPage);
  const placardPixel = await sampleCanvasPixel(exportPage, 88, 78);

  expect(debug.header).toBe('metro-placard');
  expect(debug.decorationKinds).toContain('metro-placard');
  expect(debug.stationSymbols.some((station) => station.symbol === 'dot')).toBe(true);
  expect(debug.stationSymbols.some((station) => station.symbol === 'interchange')).toBe(true);
  expect(debug.labelCollisions).toBe(false);
  expectPixelApprox(placardPixel, [22, 59, 117], 28);

  await exportPage.close();
});
