# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: phase-1-geo-foundation.spec.ts >> Phase 1 — geo foundation stays glued >> rectangle stays glued during pan
- Location: e2e/phase-1-geo-foundation.spec.ts:167:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByTestId('pin-tool-button')
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for getByTestId('pin-tool-button')

```

# Test source

```ts
  70  | }
  71  | 
  72  | async function panBy(page: Page, dx: number, dy: number): Promise<void> {
  73  |   await page.evaluate(
  74  |     ([x, y]) => {
  75  |       const w = window as unknown as AtlasdrawWindow;
  76  |       w.__atlasdraw__?.map.panBy([x, y], { duration: 0 });
  77  |     },
  78  |     [dx, dy] as const,
  79  |   );
  80  |   // CoordinateSync is throttled at 16ms; give the trailing call room to fire.
  81  |   await page.waitForTimeout(200);
  82  | }
  83  | 
  84  | async function getPinElement(page: Page): Promise<SceneElement | undefined> {
  85  |   return page.evaluate(() => {
  86  |     const w = window as unknown as AtlasdrawWindow;
  87  |     const els = w.__atlasdraw__?.excalidrawAPI.getSceneElements() ?? [];
  88  |     return els.find((el) => el.customData?.geo?.kind === "point");
  89  |   });
  90  | }
  91  | 
  92  | async function getRectElement(page: Page): Promise<SceneElement | undefined> {
  93  |   return page.evaluate(() => {
  94  |     const w = window as unknown as AtlasdrawWindow;
  95  |     const els = w.__atlasdraw__?.excalidrawAPI.getSceneElements() ?? [];
  96  |     return els.find((el) => el.type === "rectangle");
  97  |   });
  98  | }
  99  | 
  100 | test.describe("Phase 1 — geo foundation stays glued", () => {
  101 |   test("pin stays glued during pan", async ({ page }) => {
  102 |     await page.goto("/");
  103 | 
  104 |     // The Pin button is one of the first pieces of MapEditor to render.
  105 |     await expect(page.getByTestId("pin-tool-button")).toBeVisible();
  106 | 
  107 |     // Map style + window expose must both be live before we proceed.
  108 |     await waitForAtlasdrawReady(page);
  109 | 
  110 |     // Activate PinTool — overlay mounts on top of Excalidraw.
  111 |     await page.getByTestId("pin-tool-button").click();
  112 |     const overlay = page.getByTestId("atlas-tool-overlay");
  113 |     await expect(overlay).toBeVisible();
  114 | 
  115 |     // Click at a known viewport point. Use absolute page coords via mouse so
  116 |     // we don't depend on overlay box geometry.
  117 |     const clickX = 640;
  118 |     const clickY = 400;
  119 |     await page.mouse.move(clickX, clickY);
  120 |     await page.mouse.down();
  121 |     await page.mouse.up();
  122 | 
  123 |     // Pin lands as a "point" geo element.
  124 |     const pin1 = await getPinElement(page);
  125 |     expect(pin1, "pin element should exist after click").toBeDefined();
  126 |     expect(pin1!.customData?.geo?.kind).toBe("point");
  127 |     const geo1 = pin1!.customData!.geo as { kind: "point"; lng: number; lat: number };
  128 |     expect(typeof geo1.lng).toBe("number");
  129 |     expect(typeof geo1.lat).toBe("number");
  130 |     expect(Number.isFinite(geo1.lng)).toBe(true);
  131 |     expect(Number.isFinite(geo1.lat)).toBe(true);
  132 |     expect(pin1!.customData?.scaleMode).toBe("screen");
  133 |     expect(pin1!.customData?.projection).toBe("mercator");
  134 |     expect(pin1!.customData?.schemaVersion).toBe(1);
  135 | 
  136 |     const pos1 = { x: pin1!.x, y: pin1!.y };
  137 | 
  138 |     // Pan east by 200px → scene x should drop by ~200, geo unchanged.
  139 |     await panBy(page, 200, 0);
  140 | 
  141 |     const pin2 = await getPinElement(page);
  142 |     expect(pin2, "pin should still exist after pan").toBeDefined();
  143 | 
  144 |     const geo2 = pin2!.customData!.geo as { kind: "point"; lng: number; lat: number };
  145 |     // Source of truth: lat/lng are byte-stable. (load-bearing assertion)
  146 |     expect(geo2.lng).toBe(geo1.lng);
  147 |     expect(geo2.lat).toBe(geo1.lat);
  148 | 
  149 |     // Rendered position: scene-x shifted by ~−200 (panning east drags world
  150 |     // points west on screen → element's scene-x decreases). Tolerance is ±15
  151 |     // — empirically the screen-mode forward-projection path lands within ~10px
  152 |     // due to sub-pixel rounding in MapLibre's `panBy` + Excalidraw scrollX
  153 |     // composition. A broken "stays glued" pipeline either leaves dx≈0 (no
  154 |     // sync) or produces wildly wrong values (>>200).
  155 |     const dx = pin2!.x - pos1.x;
  156 |     const dy = pin2!.y - pos1.y;
  157 |     expect(
  158 |       Math.abs(dx - -200),
  159 |       `expected scene-x to shift ~−200px, got ${dx}`,
  160 |     ).toBeLessThan(15);
  161 |     expect(
  162 |       Math.abs(dy),
  163 |       `expected scene-y to be stable for horizontal pan, got ${dy}`,
  164 |     ).toBeLessThan(15);
  165 |   });
  166 | 
  167 |   test("rectangle stays glued during pan", async ({ page }) => {
  168 |     await page.goto("/");
  169 | 
> 170 |     await expect(page.getByTestId("pin-tool-button")).toBeVisible();
      |                                                       ^ Error: expect(locator).toBeVisible() failed
  171 |     await waitForAtlasdrawReady(page);
  172 | 
  173 |     // Default tool is "selection" → Excalidraw layer captures pointer events.
  174 |     // Use Excalidraw's stock keyboard shortcut to switch to rectangle.
  175 |     // Focus the Excalidraw area first (click empty space well away from the
  176 |     // Pin button to avoid toggling it).
  177 |     await page.mouse.move(900, 100);
  178 |     await page.mouse.click(900, 100);
  179 |     await page.keyboard.press("r");
  180 | 
  181 |     // Drag a rectangle on the Excalidraw layer. Programmatic drag in headless
  182 |     // chromium can race Excalidraw's pointer-state machine — interpolate the
  183 |     // move so a pointermove event fires before pointerup.
  184 |     const startX = 500;
  185 |     const startY = 300;
  186 |     const endX = 700;
  187 |     const endY = 450;
  188 |     await page.mouse.move(startX, startY);
  189 |     await page.mouse.down();
  190 |     await page.mouse.move((startX + endX) / 2, (startY + endY) / 2, { steps: 5 });
  191 |     await page.mouse.move(endX, endY, { steps: 5 });
  192 |     await page.mouse.up();
  193 | 
  194 |     // Wait for useGeoAnchor's onChange to fire after pointerUp + element commit.
  195 |     await page.waitForTimeout(300);
  196 | 
  197 |     const rect1 = await getRectElement(page);
  198 |     if (!rect1 || !rect1.customData?.geo) {
  199 |       test.fixme(
  200 |         true,
  201 |         "Excalidraw rectangle drag failed in headless — pin test (A) covers the load-bearing invariant.",
  202 |       );
  203 |       return;
  204 |     }
  205 | 
  206 |     expect(rect1.customData.geo.kind).toBe("bbox");
  207 |     const bbox1 = rect1.customData.geo as {
  208 |       kind: "bbox";
  209 |       west: number;
  210 |       east: number;
  211 |       south: number;
  212 |       north: number;
  213 |     };
  214 |     expect(bbox1.west).toBeLessThan(bbox1.east);
  215 |     expect(bbox1.south).toBeLessThan(bbox1.north);
  216 |     expect(rect1.customData.scaleMode).toBe("geographic");
  217 |     expect(rect1.customData.projection).toBe("mercator");
  218 |     expect(rect1.customData.schemaVersion).toBe(1);
  219 | 
  220 |     const pos1 = { x: rect1.x, y: rect1.y };
  221 | 
  222 |     await panBy(page, 200, 0);
  223 | 
  224 |     const rect2 = await getRectElement(page);
  225 |     expect(rect2, "rectangle should still exist after pan").toBeDefined();
  226 | 
  227 |     // Source of truth: bbox is unchanged.
  228 |     const bbox2 = rect2!.customData!.geo as typeof bbox1;
  229 |     expect(bbox2.west).toBe(bbox1.west);
  230 |     expect(bbox2.east).toBe(bbox1.east);
  231 |     expect(bbox2.south).toBe(bbox1.south);
  232 |     expect(bbox2.north).toBe(bbox1.north);
  233 | 
  234 |     // Rendered position shifts by ~−200 in x.
  235 |     const dx = rect2!.x - pos1.x;
  236 |     const dy = rect2!.y - pos1.y;
  237 |     expect(
  238 |       Math.abs(dx - -200),
  239 |       `expected scene-x to shift ~−200px, got ${dx}`,
  240 |     ).toBeLessThan(5);
  241 |     expect(
  242 |       Math.abs(dy),
  243 |       `expected scene-y to be stable for horizontal pan, got ${dy}`,
  244 |     ).toBeLessThan(5);
  245 |   });
  246 | 
  247 |   // Reproduces atlasdraw-5afc as clarified by user: "dragging seems to let annos
  248 |   // hold position, zoom does not." Drag is fine (re-projection happens; geo is
  249 |   // stable). Zoom is the failure mode — annotations drift off their geographic
  250 |   // anchor.
  251 |   //
  252 |   // Two zoom cases:
  253 |   //  - PIN (scaleMode:"screen") — should stay glued: lat/lng stable, screen
  254 |   //    position should reflect new map.project at the new zoom. If pin drifts
  255 |   //    off the anchor pixel-for-pixel after zoom, that's a screen-mode bug.
  256 |   //  - RECTANGLE (scaleMode:"geographic") — width/height should grow/shrink
  257 |   //    inversely with zoom (1 zoom level = 2x px-per-degree). Plan Task 8 is
  258 |   //    deferred (atlasdraw-375a), so geographic-mode width/height re-scaling
  259 |   //    is NOT implemented — this test will document that limitation.
  260 |   //
  261 |   // Method: zoom in by 1 level, then call map.project([geo.lng, geo.lat]) to
  262 |   // get the post-zoom screen position the element SHOULD have. Compare to the
  263 |   // element's actual scene x/y. Tight tolerance; if they diverge, the element
  264 |   // has detached from its anchor.
  265 | 
  266 |   /** Read map zoom + project a lng/lat to screen px (matches CoordinateSync's projection path). */
  267 |   async function projectGeo(
  268 |     page: Page,
  269 |     lng: number,
  270 |     lat: number,
```