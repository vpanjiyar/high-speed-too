// ── Save / Import tests ────────────────────────────────────────────────────────
// Validates the JSON download and file-upload import features.

import { test, expect } from '@playwright/test';
import path from 'path';
import os from 'os';
import fs from 'fs';

const BASE = 'http://localhost:5174';

async function waitForMap(page: import('@playwright/test').Page) {
  await page.waitForFunction(
    () => {
      const w = window as unknown as Record<string, unknown>;
      return !!w['__map'] && !!w['__networkEditor'];
    },
    { timeout: 20_000 },
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

/** Seed the map with one station and one line so there is data to export. */
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

/** Build a minimal valid NetworkExport JSON buffer. */
function buildExportJson(
  stationCount = 1,
  lineName = 'Imported Line',
): Buffer {
  const stations = Array.from({ length: stationCount }, (_, i) => ({
    id: `stn_imported_${i}`,
    name: `Imported Station ${i + 1}`,
    lng: -0.1 + i * 0.01,
    lat: 51.5 + i * 0.01,
  }));
  const payload = {
    appId: 'high-speed-too',
    version: 1,
    exportedAt: new Date().toISOString(),
    network: {
      stations,
      lines: [
        {
          id: 'line_imported_0',
          name: lineName,
          color: '#E53935',
          stationIds: stations.map((s) => s.id),
        },
      ],
    },
  };
  return Buffer.from(JSON.stringify(payload));
}

// ── UI presence ────────────────────────────────────────────────────────────────

test('save button is visible in the history controls panel', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);
  await expect(page.locator('#btn-save')).toBeVisible();
});

test('import button is visible in the history controls panel', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);
  await expect(page.locator('#btn-import')).toBeVisible();
});

test('save and import buttons are in the same container as undo/redo', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  const container = page.locator('#history-controls');
  await expect(container.locator('#btn-undo')).toBeVisible();
  await expect(container.locator('#btn-redo')).toBeVisible();
  await expect(container.locator('#btn-save')).toBeVisible();
  await expect(container.locator('#btn-import')).toBeVisible();
});

// ── Save (download) ────────────────────────────────────────────────────────────

test('save button triggers a file download', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#btn-save').click(),
  ]);

  expect(download.suggestedFilename()).toMatch(/^high-speed-too-\d{4}-\d{2}-\d{2}\.json$/);
});

test('downloaded file contains valid NetworkExport JSON', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await seedNetwork(page);

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#btn-save').click(),
  ]);

  const tmpPath = path.join(os.tmpdir(), download.suggestedFilename());
  await download.saveAs(tmpPath);
  const raw = JSON.parse(fs.readFileSync(tmpPath, 'utf8'));
  fs.unlinkSync(tmpPath);

  expect(raw.appId).toBe('high-speed-too');
  expect(raw.version).toBe(1);
  expect(typeof raw.exportedAt).toBe('string');
  expect(Array.isArray(raw.network?.stations)).toBe(true);
  expect(Array.isArray(raw.network?.lines)).toBe(true);
});

test('downloaded file contains all stations and lines from the map', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await seedNetwork(page); // 2 stations, 1 line

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#btn-save').click(),
  ]);

  const tmpPath = path.join(os.tmpdir(), download.suggestedFilename());
  await download.saveAs(tmpPath);
  const raw = JSON.parse(fs.readFileSync(tmpPath, 'utf8'));
  fs.unlinkSync(tmpPath);

  expect(raw.network.stations).toHaveLength(2);
  expect(raw.network.lines).toHaveLength(1);
  expect(raw.network.lines[0].name).toBe('Test Line');
});

test('downloaded file station objects contain required fields', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await seedNetwork(page);

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#btn-save').click(),
  ]);

  const tmpPath = path.join(os.tmpdir(), download.suggestedFilename());
  await download.saveAs(tmpPath);
  const raw = JSON.parse(fs.readFileSync(tmpPath, 'utf8'));
  fs.unlinkSync(tmpPath);

  for (const station of raw.network.stations) {
    expect(typeof station.id).toBe('string');
    expect(typeof station.name).toBe('string');
    expect(typeof station.lng).toBe('number');
    expect(typeof station.lat).toBe('number');
  }
});

test('downloaded file line objects contain required fields', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await seedNetwork(page);

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#btn-save').click(),
  ]);

  const tmpPath = path.join(os.tmpdir(), download.suggestedFilename());
  await download.saveAs(tmpPath);
  const raw = JSON.parse(fs.readFileSync(tmpPath, 'utf8'));
  fs.unlinkSync(tmpPath);

  for (const line of raw.network.lines) {
    expect(typeof line.id).toBe('string');
    expect(typeof line.name).toBe('string');
    expect(typeof line.color).toBe('string');
    expect(Array.isArray(line.stationIds)).toBe(true);
  }
});

// ── Import onto empty map (no conflict modal) ──────────────────────────────────

test('importing a valid file onto an empty map loads the network directly', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  expect(await getStationCount(page)).toBe(0);

  await page.locator('#import-file-input').setInputFiles({
    name: 'network.json',
    mimeType: 'application/json',
    buffer: buildExportJson(2, 'Direct Import'),
  });
  await page.waitForTimeout(100);

  expect(await getStationCount(page)).toBe(2);
  expect(await getLineCount(page)).toBe(1);
});

test('importing onto an empty map does not show the conflict modal', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await page.locator('#import-file-input').setInputFiles({
    name: 'network.json',
    mimeType: 'application/json',
    buffer: buildExportJson(1),
  });
  await page.waitForTimeout(100);

  await expect(page.locator('#import-modal')).toHaveClass(/hidden/);
});

test('imported stations have correct names and coordinates', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await page.locator('#import-file-input').setInputFiles({
    name: 'network.json',
    mimeType: 'application/json',
    buffer: buildExportJson(1, 'Coastal'),
  });
  await page.waitForTimeout(100);

  const station = await page.evaluate(() =>
    ((window as unknown as { __networkEditor: { network: { stations: Array<{ name: string; lng: number; lat: number }> } } })
      .__networkEditor.network.stations[0]),
  );
  expect(station.name).toBe('Imported Station 1');
  expect(station.lng).toBeCloseTo(-0.1, 3);
  expect(station.lat).toBeCloseTo(51.5, 3);
});

test('imported line has correct name and colour', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await page.locator('#import-file-input').setInputFiles({
    name: 'network.json',
    mimeType: 'application/json',
    buffer: buildExportJson(1, 'Riverside'),
  });
  await page.waitForTimeout(100);

  const line = await page.evaluate(() =>
    ((window as unknown as { __networkEditor: { network: { lines: Array<{ name: string; color: string }> } } })
      .__networkEditor.network.lines[0]),
  );
  expect(line.name).toBe('Riverside');
  expect(line.color).toBe('#E53935');
});

// ── Import conflict modal ──────────────────────────────────────────────────────

test('importing onto an existing network shows the conflict modal', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await seedNetwork(page); // put data on the map first

  await page.locator('#import-file-input').setInputFiles({
    name: 'network.json',
    mimeType: 'application/json',
    buffer: buildExportJson(1, 'New Line'),
  });
  await page.waitForTimeout(100);

  await expect(page.locator('#import-modal')).not.toHaveClass(/hidden/);
});

test('conflict modal has Replace all, Add on top, and Cancel buttons', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await seedNetwork(page);
  await page.locator('#import-file-input').setInputFiles({
    name: 'network.json',
    mimeType: 'application/json',
    buffer: buildExportJson(1),
  });
  await page.waitForTimeout(100);

  await expect(page.locator('#import-btn-replace')).toBeVisible();
  await expect(page.locator('#import-btn-merge')).toBeVisible();
  await expect(page.locator('#import-btn-cancel')).toBeVisible();
});

test('Replace all replaces existing network with imported data', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await seedNetwork(page); // 2 stations, 1 line
  expect(await getStationCount(page)).toBe(2);
  expect(await getLineCount(page)).toBe(1);

  await page.locator('#import-file-input').setInputFiles({
    name: 'network.json',
    mimeType: 'application/json',
    buffer: buildExportJson(3, 'Replaced'),
  });
  await expect(page.locator('#import-modal')).not.toHaveClass(/hidden/);

  await page.locator('#import-btn-replace').click();
  await page.waitForTimeout(100);

  expect(await getStationCount(page)).toBe(3);
  expect(await getLineCount(page)).toBe(1);

  const lineName = await page.evaluate(() =>
    ((window as unknown as { __networkEditor: { network: { lines: Array<{ name: string }> } } })
      .__networkEditor.network.lines[0].name),
  );
  expect(lineName).toBe('Replaced');
});

test('Replace all closes the conflict modal', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await seedNetwork(page);
  await page.locator('#import-file-input').setInputFiles({
    name: 'network.json',
    mimeType: 'application/json',
    buffer: buildExportJson(1),
  });
  await expect(page.locator('#import-modal')).not.toHaveClass(/hidden/);

  await page.locator('#import-btn-replace').click();
  await page.waitForTimeout(50);

  await expect(page.locator('#import-modal')).toHaveClass(/hidden/);
});

test('Add on top merges imported data with existing network', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await seedNetwork(page); // 2 stations, 1 line
  expect(await getStationCount(page)).toBe(2);
  expect(await getLineCount(page)).toBe(1);

  await page.locator('#import-file-input').setInputFiles({
    name: 'network.json',
    mimeType: 'application/json',
    buffer: buildExportJson(2, 'Merged'),
  });
  await expect(page.locator('#import-modal')).not.toHaveClass(/hidden/);

  await page.locator('#import-btn-merge').click();
  await page.waitForTimeout(100);

  // Original 2 + imported 2 = 4 stations; original 1 + imported 1 = 2 lines
  expect(await getStationCount(page)).toBe(4);
  expect(await getLineCount(page)).toBe(2);
});

test('Add on top closes the conflict modal', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await seedNetwork(page);
  await page.locator('#import-file-input').setInputFiles({
    name: 'network.json',
    mimeType: 'application/json',
    buffer: buildExportJson(1),
  });
  await expect(page.locator('#import-modal')).not.toHaveClass(/hidden/);

  await page.locator('#import-btn-merge').click();
  await page.waitForTimeout(50);

  await expect(page.locator('#import-modal')).toHaveClass(/hidden/);
});

test('merged stations get new IDs so they do not collide with existing stations', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  // Seed programmatically so the existing-data state is guaranteed
  await page.evaluate(() => {
    const editor = (window as unknown as { __networkEditor: { network: { addStation: (lng: number, lat: number, name: string) => void } } }).__networkEditor;
    editor.network.addStation(-1.0, 52.0, 'Seeded 1');
    editor.network.addStation(-1.1, 52.1, 'Seeded 2');
  });

  await page.locator('#import-file-input').setInputFiles({
    name: 'network.json',
    mimeType: 'application/json',
    buffer: buildExportJson(1),
  });
  await expect(page.locator('#import-modal')).not.toHaveClass(/hidden/);

  await page.locator('#import-btn-merge').click();
  await page.waitForTimeout(100);

  const ids = await page.evaluate(() =>
    ((window as unknown as { __networkEditor: { network: { stations: Array<{ id: string }> } } })
      .__networkEditor.network.stations).map((s) => s.id),
  );

  // All IDs must be unique
  const unique = new Set(ids);
  expect(unique.size).toBe(ids.length);

  // No imported ID (prefixed 'stn_imported_') should exist verbatim
  expect(ids.some((id) => id === 'stn_imported_0')).toBe(false);
});

test('Cancel button closes the modal without changing the network', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await seedNetwork(page);
  const stationsBefore = await getStationCount(page);
  const linesBefore = await getLineCount(page);

  await page.locator('#import-file-input').setInputFiles({
    name: 'network.json',
    mimeType: 'application/json',
    buffer: buildExportJson(3),
  });
  await expect(page.locator('#import-modal')).not.toHaveClass(/hidden/);

  await page.locator('#import-btn-cancel').click();
  await page.waitForTimeout(50);

  await expect(page.locator('#import-modal')).toHaveClass(/hidden/);
  expect(await getStationCount(page)).toBe(stationsBefore);
  expect(await getLineCount(page)).toBe(linesBefore);
});

test('clicking the modal backdrop cancels the import', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await seedNetwork(page);
  const stationsBefore = await getStationCount(page);

  await page.locator('#import-file-input').setInputFiles({
    name: 'network.json',
    mimeType: 'application/json',
    buffer: buildExportJson(3),
  });
  await expect(page.locator('#import-modal')).not.toHaveClass(/hidden/);

  // Click the backdrop (outside the modal box)
  await page.locator('#import-modal').click({ position: { x: 5, y: 5 } });
  await page.waitForTimeout(50);

  await expect(page.locator('#import-modal')).toHaveClass(/hidden/);
  expect(await getStationCount(page)).toBe(stationsBefore);
});

// ── Import validation ──────────────────────────────────────────────────────────

test('importing invalid JSON shows an alert and does not change the network', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  let alertMessage = '';
  page.on('dialog', async (dialog) => {
    alertMessage = dialog.message();
    await dialog.dismiss();
  });

  await page.locator('#import-file-input').setInputFiles({
    name: 'broken.json',
    mimeType: 'application/json',
    buffer: Buffer.from('this is not json {{{'),
  });
  await page.waitForTimeout(100);

  expect(alertMessage).toMatch(/not valid JSON/i);
  expect(await getStationCount(page)).toBe(0);
});

test('importing a JSON file with wrong appId shows an alert', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  let alertMessage = '';
  page.on('dialog', async (dialog) => {
    alertMessage = dialog.message();
    await dialog.dismiss();
  });

  const wrongApp = {
    appId: 'some-other-app',
    version: 1,
    network: { stations: [], lines: [] },
  };

  await page.locator('#import-file-input').setInputFiles({
    name: 'wrong.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(wrongApp)),
  });
  await page.waitForTimeout(100);

  expect(alertMessage).toMatch(/High Speed Too/i);
  expect(await getStationCount(page)).toBe(0);
});

test('importing a JSON file missing network property shows an alert', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  let alertMessage = '';
  page.on('dialog', async (dialog) => {
    alertMessage = dialog.message();
    await dialog.dismiss();
  });

  const bad = { appId: 'high-speed-too', version: 1 };

  await page.locator('#import-file-input').setInputFiles({
    name: 'bad.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(bad)),
  });
  await page.waitForTimeout(100);

  expect(alertMessage).toMatch(/High Speed Too/i);
});

test('importing a file with a station missing lng does not load and shows alert', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  let alertMessage = '';
  page.on('dialog', async (dialog) => {
    alertMessage = dialog.message();
    await dialog.dismiss();
  });

  const badStation = {
    appId: 'high-speed-too',
    version: 1,
    network: {
      stations: [{ id: 'x', name: 'Bad', lat: 51.5 }], // missing lng
      lines: [],
    },
  };

  await page.locator('#import-file-input').setInputFiles({
    name: 'bad.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(badStation)),
  });
  await page.waitForTimeout(100);

  expect(alertMessage).toMatch(/High Speed Too/i);
  expect(await getStationCount(page)).toBe(0);
});

// ── Round-trip ─────────────────────────────────────────────────────────────────

test('exported network can be re-imported and produces identical station/line data', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  // Build network
  await seedNetwork(page);
  // Rename the first station so we can compare names deterministically
  const originalData = await page.evaluate(() => {
    const n = (window as unknown as { __networkEditor: { network: { stations: unknown[]; lines: unknown[] } } })
      .__networkEditor.network;
    return { stations: n.stations, lines: n.lines };
  });

  // Download
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#btn-save').click(),
  ]);
  const tmpPath = path.join(os.tmpdir(), download.suggestedFilename());
  await download.saveAs(tmpPath);
  const fileBuffer = Buffer.from(fs.readFileSync(tmpPath));
  fs.unlinkSync(tmpPath);

  // Clear the network, then re-import
  await page.locator('#tool-clear').click();
  await expect(page.locator('#clear-modal')).toBeVisible();
  await page.locator('#clear-btn-confirm').click();
  await expect(page.locator('#clear-modal')).toBeHidden();
  expect(await getStationCount(page)).toBe(0);

  await page.locator('#import-file-input').setInputFiles({
    name: 'roundtrip.json',
    mimeType: 'application/json',
    buffer: fileBuffer,
  });
  await page.waitForTimeout(100);

  const reimportedData = await page.evaluate(() => {
    const n = (window as unknown as { __networkEditor: { network: { stations: Array<{ name: string; lng: number; lat: number }>; lines: Array<{ name: string; color: string; stationIds: string[] }> } } })
      .__networkEditor.network;
    return { stations: n.stations, lines: n.lines };
  });

  expect(reimportedData.stations).toHaveLength((originalData.stations as unknown[]).length);
  expect(reimportedData.lines).toHaveLength((originalData.lines as unknown[]).length);

  // Station names, coords and line names must match
  const origStations = originalData.stations as Array<{ name: string; lng: number; lat: number }>;
  for (const [i, s] of reimportedData.stations.entries()) {
    expect(s.name).toBe(origStations[i].name);
    expect(s.lng).toBeCloseTo(origStations[i].lng, 5);
    expect(s.lat).toBeCloseTo(origStations[i].lat, 5);
  }

  const origLines = originalData.lines as Array<{ name: string; color: string }>;
  for (const [i, l] of reimportedData.lines.entries()) {
    expect(l.name).toBe(origLines[i].name);
    expect(l.color).toBe(origLines[i].color);
  }
});
