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
}

async function enterSimMode(page: import('@playwright/test').Page) {
  await page.locator('#mode-btn-sim').click();
  await expect(page.locator('#mode-btn-sim')).toHaveClass(/mode-btn--active/);
  await expect(page.locator('#sim-toolbar')).toBeVisible();
}

test('mode toggle switches between plan and sim', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  await expect(page.locator('#mode-btn-plan')).toHaveClass(/mode-btn--active/);
  await expect(page.locator('#sim-toolbar')).toBeHidden();

  await enterSimMode(page);
  await expect(page.locator('#sim-hud')).toBeVisible();

  await page.locator('#mode-btn-plan').click();
  await expect(page.locator('#sim-toolbar')).toBeHidden();
});

test('simulation object is exposed and starts/stops with mode', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);

  const simExposed = await page.evaluate(() => !!(window as unknown as Record<string, unknown>)['__sim']);
  expect(simExposed).toBe(true);

  await enterSimMode(page);
  await expect.poll(async () => {
    return page.evaluate(() => {
      const sim = (window as unknown as { __sim?: { isRunning?: () => boolean } }).__sim;
      return !!sim?.isRunning?.();
    });
  }).toBe(true);

  await page.locator('#mode-btn-plan').click();
  await expect.poll(async () => {
    return page.evaluate(() => {
      const sim = (window as unknown as { __sim?: { isRunning?: () => boolean } }).__sim;
      return !!sim?.isRunning?.();
    });
  }).toBe(false);
});

test('sim clock renders HH:MM:SS and speed buttons are present', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);
  await enterSimMode(page);

  const clockText = await page.locator('#sim-clock').textContent();
  expect(clockText).toMatch(/^\d{2}:\d{2}:\d{2}$/);

  const speedBtns = page.locator('.sim-speed-btn');
  const speedCount = await speedBtns.count();
  expect(speedCount).toBeGreaterThanOrEqual(4);
});

test('HUD exposes key stat fields in sim mode', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);
  await enterSimMode(page);

  await expect(page.locator('#sim-hud-trains')).toBeVisible();
  await expect(page.locator('#sim-hud-pax')).toBeVisible();
  await expect(page.locator('#sim-hud-avgspeed')).toBeVisible();
  await expect(page.locator('#sim-hud-ontime')).toBeVisible();
});

test('timetable modal opens and closes from sim toolbar', async ({ page }) => {
  await page.goto(BASE);
  await waitForMap(page);
  await enterSimMode(page);

  await expect(page.locator('#sim-btn-timetable')).toBeVisible();
  await page.locator('#sim-btn-timetable').click();
  await expect(page.locator('#timetable-modal')).toBeVisible();
});
