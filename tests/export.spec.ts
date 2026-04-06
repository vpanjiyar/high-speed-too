// ── Export tests ────────────────────────────────────────────────────────────────
// Validates the transit map export feature: modal flow, line selection,
// style selection, legend toggle, and the generated export page.

import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:5174';

async function waitForMap(page: import('@playwright/test').Page) {
  await page.waitForFunction(
    () => (window as unknown as Record<string, unknown>)['__mapState'] === 'loaded',
    { timeout: 20_000 },
  );
}

/** Seed the map with one line and two stations so there is data to export. */
async function seedNetwork(page: import('@playwright/test').Page) {
  await page.locator('#tool-line').click();
  await page.locator('#new-line-name').fill('Test Line');
  await page.locator('#new-line-add').click();

  const canvas = await page.locator('#map canvas').boundingBox();
  const cx = canvas!.x + canvas!.width / 2;
  const cy = canvas!.y + canvas!.height / 2;
  await page.mouse.click(cx - 50, cy);
  await page.mouse.click(cx + 50, cy);
  await page.waitForTimeout(300);
}

/** Seed the map with two lines sharing a station (interchange). */
async function seedTwoLines(page: import('@playwright/test').Page) {
  await page.locator('#tool-line').click();
  await page.locator('#new-line-name').fill('Red Line');
  await page.locator('#new-line-add').click();

  const canvas = await page.locator('#map canvas').boundingBox();
  const cx = canvas!.x + canvas!.width / 2;
  const cy = canvas!.y + canvas!.height / 2;
  // Red line: left → centre → right
  await page.mouse.click(cx - 80, cy);
  await page.mouse.click(cx, cy);
  await page.mouse.click(cx + 80, cy);
  await page.waitForTimeout(300);

  // Create a second line
  await page.locator('#new-line-name').fill('Blue Line');
  await page.locator('#new-line-add').click();

  // Blue line: top → centre (same station) → bottom
  await page.mouse.click(cx, cy - 60);
  await page.mouse.click(cx, cy + 60);
  await page.waitForTimeout(300);
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

  // Lines step should be hidden, style step visible
  await expect(page.locator('#export-step-lines')).toBeHidden();
  await expect(page.locator('#export-step-style')).toBeVisible();
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

// ── Export modal — navigation ───────────────────────────────────────────────

test('back button returns to line selection step', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);
  await seedNetwork(page);

  await page.locator('#btn-export').click();
  await page.locator('#export-btn-next').click();
  await expect(page.locator('#export-step-style')).toBeVisible();

  await page.locator('#export-btn-back').click();
  await expect(page.locator('#export-step-lines')).toBeVisible();
  await expect(page.locator('#export-step-style')).toBeHidden();
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
