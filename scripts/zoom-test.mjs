// zoom-test.mjs — tests that rail lines are visible at multiple zoom levels
import { chromium } from "playwright";

const URL = "http://localhost:5174/";
const ZOOM_LEVELS = [2, 4, 6, 10];
// Centre on UK (approx mid-England)
const CENTER = { lng: -1.5, lat: 52.5 };

const browser = await chromium.launch({
  headless: true,
  args: [
    "--use-gl=angle",
    "--use-angle=swiftshader-webgl",
    "--enable-webgl",
    "--ignore-gpu-blacklist",
    "--disable-gpu-sandbox",
  ],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await context.newPage();

const pageErrors = [];
page.on("pageerror", err => pageErrors.push(err.message));

await page.goto(URL, { waitUntil: "networkidle", timeout: 20000 });

// Wait for map to reach loaded state
await page.waitForFunction(() => window.__mapState === "loaded", { timeout: 30000 });
await page.waitForTimeout(1500);

let allPass = true;

for (const zoom of ZOOM_LEVELS) {
  // Jump to the target zoom centred on mid-England
  await page.evaluate(({ lng, lat, zoom }) => {
    window.__map.jumpTo({ center: [lng, lat], zoom });
  }, { ...CENTER, zoom });

  // Wait for tiles to render at this zoom
  await page.waitForFunction(() => {
    return window.__map && !window.__map.isMoving() && window.__map.areTilesLoaded();
  }, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1200);

  const path = `scripts/zoom-test-z${zoom}.png`;
  const buf = await page.screenshot({ path });
  const bytes = buf.length;

  // Check rail layers are visible using queryRenderedFeatures on centre pixel
  const railFeatures = await page.evaluate(() => {
    const map = window.__map;
    const centre = map.project(map.getCenter());
    const box = [
      [centre.x - 200, centre.y - 200],
      [centre.x + 200, centre.y + 200],
    ];
    return map.queryRenderedFeatures(box, {
      layers: ['rail-overview', 'rail-overview-casing'],
    }).length;
  }).catch(() => -1);

  const status = railFeatures > 0 ? "PASS ✓" : "FAIL ✗";
  if (railFeatures === 0) allPass = false;
  console.log(`Zoom ${zoom.toString().padStart(2)}: ${bytes.toString().padStart(7)} bytes | rail features found: ${railFeatures} | ${status} → ${path}`);
}

if (pageErrors.length) {
  console.log("\n--- Page errors ---");
  pageErrors.forEach(e => console.log("  " + e.substring(0, 300)));
}

console.log(allPass ? "\n✓ ALL ZOOM LEVELS PASS" : "\n✗ SOME ZOOM LEVELS FAILED");
await browser.close();
