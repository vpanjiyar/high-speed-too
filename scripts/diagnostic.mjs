// diagnostic.mjs
import { chromium } from "playwright";
import { createWriteStream, statSync } from "fs";

const URL = "http://localhost:5174/";

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

const consoleMessages = [];
const pageErrors = [];
page.on("console", msg => consoleMessages.push({ type: msg.type(), text: msg.text() }));
page.on("pageerror", err => pageErrors.push(err.message));

console.log("\nNavigating to " + URL + "...");
await page.goto(URL, { waitUntil: "networkidle", timeout: 20000 }).catch(e => console.log("Nav error:", e.message));

// Wait for map style to load or error (use styledata or loaded state)
const stateResult = await page.waitForFunction(() => {
  const state = window.__mapState;
  return state && state !== "init";
}, { timeout: 30000 }).then(h => h.jsonValue()).catch(() => "timeout");

const finalState = typeof stateResult === "string" ? stateResult : await page.evaluate(() => window.__mapState);
console.log("Map state:", finalState);

// Wait extra time for tiles and labels to render
await page.waitForTimeout(2000);

// DOM checks
const mapBounds = await page.$eval("#map", el => {
  const r = el.getBoundingClientRect();
  return { w: r.width, h: r.height };
}).catch(() => null);
console.log("#map dimensions:", mapBounds ? mapBounds.w + "x" + mapBounds.h : "NOT FOUND");

// Take screenshot — this correctly captures composited WebGL output
const screenshotBuf = await page.screenshot({ path: "scripts/diagnostic-screenshot.png" });
const screenshotBytes = screenshotBuf.length;
console.log("\nScreenshot size:", screenshotBytes, "bytes");

// A rendered map with roads, labels, ocean etc. should be >100 KB
// A blank/empty page is typically <30 KB
const mapRendered = screenshotBytes > 100_000;
console.log("Map rendered:", mapRendered ? "YES ✓" : "NO ✗ (screenshot too small — map may be blank)");

if (mapRendered) {
  console.log("\n✓ PASS — UK map is rendering correctly.");
} else {
  console.log("\n✗ FAIL — Map does not appear to be rendering.");
}

// Console messages (warnings/errors only)
const relevant = consoleMessages.filter(m => m.type === "error" || m.type === "warning");
if (relevant.length) {
  console.log("\n--- Console warnings/errors ---");
  // Deduplicate glyph errors to avoid flooding the output
  const seen = new Set();
  relevant.forEach(m => {
    const key = m.text.substring(0, 100);
    if (!seen.has(key)) { seen.add(key); console.log("  [" + m.type + "] " + m.text.substring(0, 200)); }
  });
}
if (pageErrors.length) {
  console.log("\n--- Page errors ---");
  pageErrors.forEach(e => console.log("  " + e.substring(0, 300)));
}

console.log("\nScreenshot saved: scripts/diagnostic-screenshot.png");
await browser.close();

