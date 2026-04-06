# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: view-toggle.spec.ts >> schematic mode does not hide user-drawn network lines
- Location: tests\view-toggle.spec.ts:317:1

# Error details

```
Test timeout of 60000ms exceeded.
```

```
Error: locator.click: Test timeout of 60000ms exceeded.
Call log:
  - waiting for locator('#view-btn-schematic')
    - locator resolved to <button class="view-btn" title="Schematic view" id="view-btn-schematic">…</button>
  - attempting click action
    2 × waiting for element to be visible, enabled and stable
      - element is visible, enabled and stable
      - scrolling into view if needed
      - done scrolling
      - <input type="text" maxlength="60" autocomplete="off" spellcheck="false" id="line-manager-name" placeholder="Line name…"/> from <div class="" id="line-manager">…</div> subtree intercepts pointer events
    - retrying click action
    - waiting 20ms
    2 × waiting for element to be visible, enabled and stable
      - element is visible, enabled and stable
      - scrolling into view if needed
      - done scrolling
      - <input type="text" maxlength="60" autocomplete="off" spellcheck="false" id="line-manager-name" placeholder="Line name…"/> from <div class="" id="line-manager">…</div> subtree intercepts pointer events
    - retrying click action
      - waiting 100ms
    103 × waiting for element to be visible, enabled and stable
        - element is visible, enabled and stable
        - scrolling into view if needed
        - done scrolling
        - <input type="text" maxlength="60" autocomplete="off" spellcheck="false" id="line-manager-name" placeholder="Line name…"/> from <div class="" id="line-manager">…</div> subtree intercepts pointer events
      - retrying click action
        - waiting 500ms

```

# Page snapshot

```yaml
- generic [ref=e1]:
  - generic [ref=e2]:
    - region "Map" [active] [ref=e3]
    - generic:
      - group [ref=e4]:
        - generic "Toggle attribution" [ref=e5] [cursor=pointer]
        - generic [ref=e6]:
          - text: ©
          - link "OpenStreetMap" [ref=e7] [cursor=pointer]:
            - /url: https://openstreetmap.org
          - text: contributors ·
          - link "Protomaps" [ref=e8] [cursor=pointer]:
            - /url: https://protomaps.com
      - generic:
        - generic [ref=e9]: 100 km
        - generic [ref=e10]:
          - button "Zoom in" [ref=e11] [cursor=pointer]
          - button "Zoom out" [ref=e13] [cursor=pointer]
          - button "Drag to rotate map, click to reset north" [ref=e15]
  - generic:
    - generic:
      - generic [ref=e17]: High Speed Too
      - generic [ref=e18]:
        - button "Undo (Ctrl+Z)" [ref=e19] [cursor=pointer]:
          - img [ref=e20]
        - button "Redo (Ctrl+R)" [disabled] [ref=e23]:
          - img [ref=e24]
        - button "Save network to file" [ref=e28] [cursor=pointer]:
          - img [ref=e29]
        - button "Import network from file" [ref=e31] [cursor=pointer]:
          - img [ref=e32]
        - button "Export transit map" [ref=e35] [cursor=pointer]:
          - img [ref=e36]
    - generic [ref=e39]:
      - button "Detailed" [ref=e40] [cursor=pointer]:
        - img [ref=e41]
        - generic [ref=e46]: Detailed
      - button "Schematic" [ref=e47] [cursor=pointer]:
        - img [ref=e48]
        - generic [ref=e52]: Schematic
    - generic [ref=e53]:
      - generic [ref=e54]: Overlays
      - generic [ref=e55]:
        - generic [ref=e56]: Rail Infrastructure
        - generic [ref=e57]:
          - generic [ref=e58] [cursor=pointer]:
            - checkbox "National rail" [checked]
            - generic [ref=e60]: National rail
          - generic [ref=e61] [cursor=pointer]:
            - checkbox "City metros" [checked]
            - generic [ref=e63]: City metros
          - generic [ref=e64] [cursor=pointer]:
            - checkbox "Stations" [checked]
            - generic [ref=e66]: Stations
      - generic [ref=e68]:
        - generic [ref=e69]: Census
        - group [ref=e70]:
          - generic [ref=e71] [cursor=pointer]:
            - radio "Off" [checked]
            - generic [ref=e73]: "Off"
          - generic [ref=e74] [cursor=pointer]:
            - radio "Population"
            - generic [ref=e77]: Population
          - generic [ref=e78] [cursor=pointer]:
            - radio "Density (pop/ha)"
            - generic [ref=e81]: Density (pop/ha)
          - generic [ref=e82] [cursor=pointer]:
            - radio "Working Age %"
            - generic [ref=e85]: Working Age %
        - generic [ref=e86]: Updated 5 Apr 2026
    - generic [ref=e87]:
      - button "Select" [ref=e88] [cursor=pointer]:
        - img [ref=e89]
        - generic [ref=e91]: Select
      - button "Station" [ref=e92] [cursor=pointer]:
        - img [ref=e93]
        - generic [ref=e96]: Station
      - button "Line" [ref=e97] [cursor=pointer]:
        - img [ref=e98]
        - generic [ref=e103]: Line
      - button "Clear" [ref=e105] [cursor=pointer]:
        - img [ref=e106]
        - generic [ref=e108]: Clear
    - generic [ref=e109]:
      - generic [ref=e110]:
        - generic [ref=e111]: Lines
        - button "×" [ref=e112] [cursor=pointer]
      - generic [ref=e113]:
        - textbox "Line name…" [ref=e114]
        - button "Add Line" [ref=e126] [cursor=pointer]
      - generic [ref=e128] [cursor=pointer]:
        - generic [ref=e130]: Line 1
        - generic [ref=e131]: 1 stn
        - button "×" [ref=e132]
    - generic [ref=e133]:
      - generic [ref=e134]:
        - generic [ref=e135]:
          - img [ref=e137]
          - textbox "Line name…" [ref=e140]: Line 1
        - button "Close" [ref=e141] [cursor=pointer]:
          - img [ref=e142]
      - generic [ref=e144]:
        - generic [ref=e146]: Colour
        - generic [ref=e159]:
          - generic [ref=e160]:
            - text: Catchment
            - generic [ref=e161]: all stops combined
          - generic [ref=e162]:
            - generic [ref=e163]:
              - generic [ref=e164]: 6,639
              - generic [ref=e165]: Residents
            - generic [ref=e166]:
              - generic [ref=e167]: 4,276
              - generic [ref=e168]: Working age
            - generic [ref=e169]:
              - generic [ref=e170]: 64.4%
              - generic [ref=e171]: Work. age %
            - generic [ref=e172]:
              - generic [ref=e173]: "17.0"
              - generic [ref=e174]: Pop / ha
        - generic [ref=e176]:
          - generic [ref=e177]: Rolling Stock
          - button "Choose a train…" [ref=e179] [cursor=pointer]
        - generic [ref=e182]:
          - generic [ref=e183]:
            - text: Stops
            - generic [ref=e184]: 1 stop
          - generic [ref=e186] [cursor=pointer]:
            - generic [ref=e191]: Whitehaven Rail Station
            - generic [ref=e192]: ›
        - button "Delete line" [ref=e195] [cursor=pointer]
    - generic [ref=e196]:
      - button "UK" [ref=e197] [cursor=pointer]
      - button "Region" [ref=e198] [cursor=pointer]
      - button "City" [ref=e199] [cursor=pointer]
      - button "Street" [ref=e200] [cursor=pointer]
```

# Test source

```ts
  228 |   await waitForMap(page);
  229 | 
  230 |   await page.locator('#view-btn-detailed').click(); // already active — no-op
  231 |   await page.locator('#view-btn-detailed').click();
  232 | 
  233 |   await expect(page.locator('#view-btn-detailed')).toHaveClass(/view-btn--active/);
  234 | 
  235 |   const color = await page.evaluate(() =>
  236 |     (window as unknown as { __map: TestMap }).__map
  237 |       .getPaintProperty('background', 'background-color'),
  238 |   );
  239 |   expect(color).toBe('#B0CCDF');
  240 | });
  241 | 
  242 | // ── Rail infrastructure overlay toggles in schematic mode ────────────────────
  243 | 
  244 | test('national rail overlay toggle works in schematic mode', async ({ page }) => {
  245 |   await page.goto(BASE);
  246 |   await waitForMap(page);
  247 | 
  248 |   await page.locator('#view-btn-schematic').click();
  249 | 
  250 |   const railToggleLabel = page.locator('label.overlay-toggle').filter({
  251 |     has: page.locator('#toggle-rail-lines'),
  252 |   });
  253 | 
  254 |   // Initially checked
  255 |   await expect(page.locator('#toggle-rail-lines')).toBeChecked();
  256 | 
  257 |   // Uncheck via the visible label
  258 |   await railToggleLabel.click();
  259 |   await expect(page.locator('#toggle-rail-lines')).not.toBeChecked();
  260 | 
  261 |   // Re-check
  262 |   await railToggleLabel.click();
  263 |   await expect(page.locator('#toggle-rail-lines')).toBeChecked();
  264 | });
  265 | 
  266 | test('city metro overlay toggle works in schematic mode', async ({ page }) => {
  267 |   await page.goto(BASE);
  268 |   await waitForMap(page);
  269 | 
  270 |   await page.locator('#view-btn-schematic').click();
  271 | 
  272 |   const metroToggleLabel = page.locator('label.overlay-toggle').filter({
  273 |     has: page.locator('#toggle-metro-lines'),
  274 |   });
  275 | 
  276 |   await expect(page.locator('#toggle-metro-lines')).toBeChecked();
  277 |   await metroToggleLabel.click();
  278 |   await expect(page.locator('#toggle-metro-lines')).not.toBeChecked();
  279 | });
  280 | 
  281 | test('stations overlay toggle works in schematic mode', async ({ page }) => {
  282 |   await page.goto(BASE);
  283 |   await waitForMap(page);
  284 | 
  285 |   await page.locator('#view-btn-schematic').click();
  286 | 
  287 |   const stationsToggleLabel = page.locator('label.overlay-toggle').filter({
  288 |     has: page.locator('#toggle-rail-stations'),
  289 |   });
  290 | 
  291 |   await expect(page.locator('#toggle-rail-stations')).toBeChecked();
  292 |   await stationsToggleLabel.click();
  293 |   await expect(page.locator('#toggle-rail-stations')).not.toBeChecked();
  294 | });
  295 | 
  296 | test('overlay toggle state is preserved when switching between modes', async ({ page }) => {
  297 |   await page.goto(BASE);
  298 |   await waitForMap(page);
  299 | 
  300 |   // Turn off national rail in detailed mode
  301 |   await page.locator('label.overlay-toggle').filter({
  302 |     has: page.locator('#toggle-rail-lines'),
  303 |   }).click();
  304 |   await expect(page.locator('#toggle-rail-lines')).not.toBeChecked();
  305 | 
  306 |   // Switch to schematic — toggle remains off
  307 |   await page.locator('#view-btn-schematic').click();
  308 |   await expect(page.locator('#toggle-rail-lines')).not.toBeChecked();
  309 | 
  310 |   // Switch back — still off
  311 |   await page.locator('#view-btn-detailed').click();
  312 |   await expect(page.locator('#toggle-rail-lines')).not.toBeChecked();
  313 | });
  314 | 
  315 | // ── User-drawn network unaffected ─────────────────────────────────────────────
  316 | 
  317 | test('schematic mode does not hide user-drawn network lines', async ({ page }) => {
  318 |   await page.goto(BASE);
  319 |   await waitForMap(page);
  320 | 
  321 |   // Create a line and draw a stop so the network-line layer exists
  322 |   await page.locator('#tool-line').click();
  323 |   await page.locator('#new-line-add').click();
  324 |   const canvas = await page.locator('#map canvas').boundingBox();
  325 |   await page.mouse.click(canvas!.x + canvas!.width / 2, canvas!.y + canvas!.height / 2);
  326 |   await page.waitForTimeout(300);
  327 | 
> 328 |   await page.locator('#view-btn-schematic').click();
      |                                             ^ Error: locator.click: Test timeout of 60000ms exceeded.
  329 | 
  330 |   const visibility = await page.evaluate(() =>
  331 |     (window as unknown as { __map: TestMap }).__map
  332 |       .getLayoutProperty('network-line', 'visibility'),
  333 |   );
  334 |   // Layer exists but visibility was never set to 'none' by schematic mode
  335 |   expect(visibility).not.toBe('none');
  336 | });
  337 | 
  338 | test('schematic mode does not hide user-drawn station circles', async ({ page }) => {
  339 |   await page.goto(BASE);
  340 |   await waitForMap(page);
  341 | 
  342 |   await page.locator('#tool-station').click();
  343 |   const canvas = await page.locator('#map canvas').boundingBox();
  344 |   await page.mouse.click(canvas!.x + canvas!.width / 2, canvas!.y + canvas!.height / 2);
  345 |   await page.waitForTimeout(300);
  346 | 
  347 |   await page.locator('#view-btn-schematic').click();
  348 | 
  349 |   const visibility = await page.evaluate(() =>
  350 |     (window as unknown as { __map: TestMap }).__map
  351 |       .getLayoutProperty('network-station-outer', 'visibility'),
  352 |   );
  353 |   expect(visibility).not.toBe('none');
  354 | });
  355 | 
```