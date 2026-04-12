// Visual verification script — takes screenshots of key UI states
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  // Collect console errors
  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', err => {
    errors.push('PAGE_ERROR: ' + err.message);
  });

  await page.goto('http://localhost:5174', { waitUntil: 'networkidle', timeout: 30000 });

  // Wait for map to load
  await page.waitForFunction(() => window.__mapState === 'loaded', { timeout: 15000 });
  await page.waitForTimeout(1500);

  // ── Screenshot 1: Plan mode — overlays panel visible
  await page.screenshot({ path: 'verify-01-plan-mode.png' });
  console.log('✓ Screenshot 1: Plan mode');

  // ── Create a test line with real stations
  // Zoom into a station-dense area (London)
  await page.evaluate(() => {
    window.__map.jumpTo({ center: [-0.12, 51.5], zoom: 10 });
  });
  await page.waitForTimeout(1000);

  // Switch to station mode and click near a real station
  await page.click('#tool-station');
  await page.waitForTimeout(300);

  // Click on the map near Kings Cross area
  const mapEl = await page.$('#map');
  const mapBox = await mapEl.boundingBox();

  // Click a spot that should be near a NaPTAN station
  await page.mouse.click(mapBox.x + mapBox.width * 0.5, mapBox.y + mapBox.height * 0.5);
  await page.waitForTimeout(500);

  // Switch to select mode
  await page.click('#tool-select');
  await page.waitForTimeout(300);

  // Try clicking on a NaPTAN station (just click somewhere on the map)
  await page.mouse.click(mapBox.x + mapBox.width * 0.48, mapBox.y + mapBox.height * 0.48);
  await page.waitForTimeout(800);

  // ── Screenshot 2: Station selected in plan mode (should show station manager)
  await page.screenshot({ path: 'verify-02-station-selected.png' });
  console.log('✓ Screenshot 2: Station selected');

  // Check if station manager is visible
  const smVisible = await page.evaluate(() => {
    const sm = document.getElementById('station-manager');
    return sm && !sm.classList.contains('hidden');
  });
  console.log(`  Station manager visible: ${smVisible}`);

  // Check if platform controls exist
  const platformControlsExist = await page.evaluate(() => {
    return !!document.getElementById('sm-platform-count');
  });
  console.log(`  Platform controls exist: ${platformControlsExist}`);

  // ── Enter sim mode
  // Debug: check map state
  const mapState = await page.evaluate(() => window.__mapState);
  console.log(`  Map state: ${mapState}`);
  console.log(`  Errors so far: ${JSON.stringify(errors)}`);

  // Check if event listeners bound by checking something set up in the same callback
  const simToolbarExists = await page.evaluate(() => {
    const tb = document.getElementById('sim-toolbar');
    return tb ? tb.className : 'not found';
  });
  console.log(`  Sim toolbar class before: ${simToolbarExists}`);

  // Debug: check if button exists and is clickable
  const btnInfo = await page.evaluate(() => {
    const btn = document.getElementById('mode-btn-sim');
    if (!btn) return 'button not found';
    const rect = btn.getBoundingClientRect();
    const style = getComputedStyle(btn);
    return {
      exists: true,
      visible: style.display !== 'none' && style.visibility !== 'hidden',
      rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
      pointerEvents: style.pointerEvents,
      disabled: btn.disabled,
      classList: [...btn.classList],
    };
  });
  console.log(`  Sim button info: ${JSON.stringify(btnInfo)}`);

  // Try clicking with evaluate instead
  const clickResult = await page.evaluate(() => {
    try {
      const btn = document.getElementById('mode-btn-sim');
      // Check how many listeners (not directly possible, but try)
      const evt = new MouseEvent('click', { bubbles: true, cancelable: true });
      const dispatched = btn.dispatchEvent(evt);
      return { dispatched, bodyClasses: [...document.body.classList] };
    } catch (e) {
      return { error: e.message, stack: e.stack };
    }
  });
  console.log(`  Click result: ${JSON.stringify(clickResult)}`);
  await page.waitForTimeout(2000);

  // Check body class
  const bodyClasses = await page.evaluate(() => [...document.body.classList]);
  console.log(`  Body classes after click: ${JSON.stringify(bodyClasses)}`);

  // ── Screenshot 3: Sim mode — overlays panel should be HIDDEN
  await page.screenshot({ path: 'verify-03-sim-mode.png' });
  console.log('✓ Screenshot 3: Sim mode');

  // Check overlays panel visibility in sim mode
  const overlaysHidden = await page.evaluate(() => {
    const panel = document.getElementById('overlays-panel');
    if (!panel) return 'not found';
    const style = getComputedStyle(panel);
    return style.display === 'none' ? 'hidden' : 'visible';
  });
  console.log(`  Overlays panel in sim mode: ${overlaysHidden}`);

  // Check sim toolbar visibility
  const simToolbarVisible = await page.evaluate(() => {
    const tb = document.getElementById('sim-toolbar');
    if (!tb) return 'not found';
    return tb.classList.contains('hidden') ? 'hidden' : 'visible';
  });
  console.log(`  Sim toolbar: ${simToolbarVisible}`);

  // Check sim HUD visibility
  const simHudVisible = await page.evaluate(() => {
    const hud = document.getElementById('sim-hud');
    if (!hud) return 'not found';
    return hud.classList.contains('hidden') ? 'hidden' : 'visible';
  });
  console.log(`  Sim HUD: ${simHudVisible}`);

  // Check time input and realtime button exist
  const timeControls = await page.evaluate(() => {
    return {
      clockEl: !!document.getElementById('sim-clock'),
      timeInput: !!document.getElementById('sim-time-input'),
      realtimeBtn: !!document.getElementById('sim-btn-realtime'),
    };
  });
  console.log(`  Time controls: ${JSON.stringify(timeControls)}`);

  // ── Test time picker interaction
  await page.click('#sim-clock');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'verify-04-time-picker.png' });
  console.log('✓ Screenshot 4: Time picker open');

  const timeInputVisible = await page.evaluate(() => {
    const input = document.getElementById('sim-time-input');
    return input ? getComputedStyle(input).display !== 'none' : false;
  });
  console.log(`  Time input visible: ${timeInputVisible}`);

  // Press escape to close time picker
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // ── Test "Now" button
  await page.click('#sim-btn-realtime');
  await page.waitForTimeout(500);
  const clockAfterNow = await page.evaluate(() => {
    return document.getElementById('sim-clock')?.textContent ?? '';
  });
  console.log(`  Clock after "Now" click: ${clockAfterNow}`);

  // ── Go back to plan mode
  await page.click('#mode-btn-plan');
  await page.waitForTimeout(1000);

  // ── Screenshot 5: Plan mode restored — overlays should be back
  await page.screenshot({ path: 'verify-05-plan-restored.png' });
  console.log('✓ Screenshot 5: Plan mode restored');

  const overlaysRestoredVisible = await page.evaluate(() => {
    const panel = document.getElementById('overlays-panel');
    if (!panel) return 'not found';
    const style = getComputedStyle(panel);
    return style.display === 'none' ? 'hidden' : 'visible';
  });
  console.log(`  Overlays panel restored: ${overlaysRestoredVisible}`);

  // Summary
  console.log('\n=== Summary ===');
  console.log(`Console errors: ${errors.length}`);
  errors.forEach(e => console.log(`  ERROR: ${e}`));
  console.log(`Overlays hidden in sim mode: ${overlaysHidden === 'hidden' ? '✓ PASS' : '✗ FAIL'}`);
  console.log(`Sim toolbar visible: ${simToolbarVisible === 'visible' ? '✓ PASS' : '✗ FAIL'}`);
  console.log(`Time controls present: ${timeControls.clockEl && timeControls.timeInput && timeControls.realtimeBtn ? '✓ PASS' : '✗ FAIL'}`);
  console.log(`Platform controls present: ${platformControlsExist ? '✓ PASS' : '✗ FAIL'}`);
  console.log(`Overlays restored in plan: ${overlaysRestoredVisible === 'visible' ? '✓ PASS' : '✗ FAIL'}`);

  await browser.close();
})();
