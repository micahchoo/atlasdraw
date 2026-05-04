# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: phase-1-geo-foundation.spec.ts >> Phase 1 — geo foundation stays glued >> pin stays glued during ZOOM (atlasdraw-5afc, scaleMode:screen)
- Location: e2e/phase-1-geo-foundation.spec.ts:279:7

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
  271 |   ): Promise<{ x: number; y: number; zoom: number }> {
  272 |     return page.evaluate(([lng, lat]) => {
  273 |       const m = (window as unknown as { __atlasdraw__?: { map: any } }).__atlasdraw__!.map;
  274 |       const p = (m as any).project([lng, lat]);
  275 |       return { x: p.x, y: p.y, zoom: (m as any).getZoom() };
  276 |     }, [lng, lat] as const);
  277 |   }
  278 | 
  279 |   test("pin stays glued during ZOOM (atlasdraw-5afc, scaleMode:screen)", async ({
  280 |     page,
  281 |   }) => {
  282 |     await page.goto("/");
> 283 |     await expect(page.getByTestId("pin-tool-button")).toBeVisible();
      |                                                       ^ Error: expect(locator).toBeVisible() failed
  284 |     await waitForAtlasdrawReady(page);
  285 | 
  286 |     // Place pin at viewport center-ish.
  287 |     await page.getByTestId("pin-tool-button").click();
  288 |     await expect(page.getByTestId("atlas-tool-overlay")).toBeVisible();
  289 |     await page.mouse.move(640, 400);
  290 |     await page.mouse.down();
  291 |     await page.mouse.up();
  292 |     await expect(page.getByTestId("atlas-tool-overlay")).toBeHidden();
  293 | 
  294 |     const pin1 = await getPinElement(page);
  295 |     expect(pin1, "pin should exist after click").toBeDefined();
  296 |     const geo1 = pin1!.customData!.geo as { kind: "point"; lng: number; lat: number };
  297 | 
  298 |     const before = await projectGeo(page, geo1.lng, geo1.lat);
  299 |     // Sanity: at zoom 0 (initial map state), element's scene position should
  300 |     // match the projected screen position of its lat/lng. Within ~2px of click.
  301 |     console.log(
  302 |       `[5afc-zoom-pin] pre: zoom=${before.zoom} scene=(${pin1!.x},${pin1!.y}) projected=(${before.x.toFixed(1)},${before.y.toFixed(1)})`,
  303 |     );
  304 | 
  305 |     // Zoom in by 1 level programmatically. duration:0 = synchronous.
  306 |     await page.evaluate(() => {
  307 |       const m = (window as unknown as { __atlasdraw__?: { map: any } }).__atlasdraw__!.map;
  308 |       (m as any).zoomTo((m as any).getZoom() + 1, { duration: 0 });
  309 |     });
  310 |     await page.waitForTimeout(300); // throttle settle + frame
  311 | 
  312 |     const pin2 = await getPinElement(page);
  313 |     expect(pin2, "pin should still exist after zoom").toBeDefined();
  314 |     const geo2 = pin2!.customData!.geo as { kind: "point"; lng: number; lat: number };
  315 | 
  316 |     // Source of truth: geo must be unchanged.
  317 |     expect(geo2.lng).toBe(geo1.lng);
  318 |     expect(geo2.lat).toBe(geo1.lat);
  319 | 
  320 |     const after = await projectGeo(page, geo1.lng, geo1.lat);
  321 |     const expectedX = after.x;
  322 |     const expectedY = after.y;
  323 |     const actualX = pin2!.x;
  324 |     const actualY = pin2!.y;
  325 |     const driftX = actualX - expectedX;
  326 |     const driftY = actualY - expectedY;
  327 |     console.log(
  328 |       `[5afc-zoom-pin] post: zoom=${after.zoom} scene=(${actualX},${actualY}) expectedProjected=(${expectedX.toFixed(1)},${expectedY.toFixed(1)}) drift=(${driftX.toFixed(1)},${driftY.toFixed(1)})`,
  329 |     );
  330 | 
  331 |     // Pin should sit within a few px of where map.project says its lat/lng is.
  332 |     // Larger tolerance (10px) accounts for mid-element vs corner-element offset
  333 |     // (PinTool centers a 16x16 ellipse on the click point, so element.x is
  334 |     // top-left = projected-x - 8). Bug presents as drift much larger than 10.
  335 |     expect(
  336 |       Math.abs(driftX),
  337 |       `pin scene-x drifted ${driftX.toFixed(1)}px from projected lat/lng after zoom`,
  338 |     ).toBeLessThan(10);
  339 |     expect(
  340 |       Math.abs(driftY),
  341 |       `pin scene-y drifted ${driftY.toFixed(1)}px from projected lat/lng after zoom`,
  342 |     ).toBeLessThan(10);
  343 |   });
  344 | 
  345 |   test("rectangle stays glued during ZOOM (atlasdraw-5afc, scaleMode:geographic)", async ({
  346 |     page,
  347 |   }) => {
  348 |     await page.goto("/");
  349 |     await expect(page.getByTestId("pin-tool-button")).toBeVisible();
  350 |     await waitForAtlasdrawReady(page);
  351 | 
  352 |     // Switch to rectangle via imperative API (avoids keyboard focus issues).
  353 |     await page.evaluate(() => {
  354 |       const w = window as unknown as AtlasdrawWindow;
  355 |       w.__atlasdraw__?.excalidrawAPI.setActiveTool({ type: "rectangle" });
  356 |     });
  357 |     await page.waitForTimeout(50);
  358 | 
  359 |     // Drag a rectangle.
  360 |     const startX = 500;
  361 |     const startY = 300;
  362 |     const endX = 700;
  363 |     const endY = 450;
  364 |     await page.mouse.move(startX, startY);
  365 |     await page.mouse.down();
  366 |     await page.mouse.move((startX + endX) / 2, (startY + endY) / 2, { steps: 5 });
  367 |     await page.mouse.move(endX, endY, { steps: 5 });
  368 |     await page.mouse.up();
  369 |     await page.waitForTimeout(300);
  370 | 
  371 |     const rect1 = await getRectElement(page);
  372 |     if (!rect1 || !rect1.customData?.geo) {
  373 |       test.fixme(true, "Rectangle drag failed in headless — see Test B for context.");
  374 |       return;
  375 |     }
  376 |     const bbox1 = rect1.customData.geo as {
  377 |       kind: "bbox";
  378 |       west: number;
  379 |       east: number;
  380 |       south: number;
  381 |       north: number;
  382 |     };
  383 |     const w1 = rect1.width;
```