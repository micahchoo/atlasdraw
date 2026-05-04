# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: phase-1-geo-foundation.spec.ts >> Phase 1 — geo foundation stays glued >> pin stays glued during INTERACTIVE wheel zoom (atlasdraw-5afc)
- Location: e2e/phase-1-geo-foundation.spec.ts:438:7

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
  384 |     const h1 = rect1.height;
  385 |     console.log(
  386 |       `[5afc-zoom-rect] pre: scene=(${rect1.x},${rect1.y}) wh=(${w1},${h1}) bbox.lng=[${bbox1.west.toFixed(4)},${bbox1.east.toFixed(4)}]`,
  387 |     );
  388 | 
  389 |     // Zoom in by 1 level → 2x pixel density per degree.
  390 |     await page.evaluate(() => {
  391 |       const m = (window as unknown as { __atlasdraw__?: { map: any } }).__atlasdraw__!.map;
  392 |       (m as any).zoomTo((m as any).getZoom() + 1, { duration: 0 });
  393 |     });
  394 |     await page.waitForTimeout(300);
  395 | 
  396 |     const rect2 = await getRectElement(page);
  397 |     expect(rect2, "rectangle should still exist after zoom").toBeDefined();
  398 |     const bbox2 = rect2!.customData!.geo as typeof bbox1;
  399 | 
  400 |     // Source of truth: bbox is unchanged.
  401 |     expect(bbox2.west).toBe(bbox1.west);
  402 |     expect(bbox2.east).toBe(bbox1.east);
  403 |     expect(bbox2.south).toBe(bbox1.south);
  404 |     expect(bbox2.north).toBe(bbox1.north);
  405 | 
  406 |     // Compute expected width/height from projected NW + SE corners at new zoom.
  407 |     const nw = await projectGeo(page, bbox1.west, bbox1.north);
  408 |     const se = await projectGeo(page, bbox1.east, bbox1.south);
  409 |     const expectedW = se.x - nw.x;
  410 |     const expectedH = se.y - nw.y;
  411 |     const driftW = rect2!.width - expectedW;
  412 |     const driftH = rect2!.height - expectedH;
  413 |     console.log(
  414 |       `[5afc-zoom-rect] post: scene=(${rect2!.x},${rect2!.y}) wh=(${rect2!.width},${rect2!.height}) expectedWH=(${expectedW.toFixed(1)},${expectedH.toFixed(1)}) driftWH=(${driftW.toFixed(1)},${driftH.toFixed(1)})`,
  415 |     );
  416 | 
  417 |     // EXPECTED TO FAIL until Task 8 (atlasdraw-375a) lands width/height
  418 |     // re-scaling for scaleMode:geographic. After zoom-in by 1 level, the
  419 |     // rectangle's pixel width/height should ~double; today they stay at the
  420 |     // initial drag size (~200x150), so driftW ≈ -200 px.
  421 |     test.info().annotations.push({
  422 |       type: "issue",
  423 |       description: `atlasdraw-5afc / atlasdraw-375a — scaleMode:geographic width/height not re-scaled on zoom`,
  424 |     });
  425 |     expect(
  426 |       Math.abs(driftW),
  427 |       `rectangle width drifted ${driftW.toFixed(1)}px from geographic span after zoom (Task 8 not implemented)`,
  428 |     ).toBeLessThan(20);
  429 |     expect(
  430 |       Math.abs(driftH),
  431 |       `rectangle height drifted ${driftH.toFixed(1)}px from geographic span after zoom (Task 8 not implemented)`,
  432 |     ).toBeLessThan(20);
  433 |   });
  434 | 
  435 |   // Interactive wheel zoom — the path the user actually uses. MapLibre's
  436 |   // scrollZoom handler reads wheel events on its canvas and fires "zoom" + "move"
  437 |   // events. If those don't reach useCoordinateSync, annotations won't re-project.
  438 |   test("pin stays glued during INTERACTIVE wheel zoom (atlasdraw-5afc)", async ({
  439 |     page,
  440 |   }) => {
  441 |     await page.goto("/");
> 442 |     await expect(page.getByTestId("pin-tool-button")).toBeVisible();
      |                                                       ^ Error: expect(locator).toBeVisible() failed
  443 |     await waitForAtlasdrawReady(page);
  444 | 
  445 |     await page.getByTestId("pin-tool-button").click();
  446 |     await expect(page.getByTestId("atlas-tool-overlay")).toBeVisible();
  447 |     await page.mouse.move(640, 400);
  448 |     await page.mouse.down();
  449 |     await page.mouse.up();
  450 |     await expect(page.getByTestId("atlas-tool-overlay")).toBeHidden();
  451 | 
  452 |     const pin1 = await getPinElement(page);
  453 |     expect(pin1, "pin should exist").toBeDefined();
  454 |     const geo1 = pin1!.customData!.geo as { kind: "point"; lng: number; lat: number };
  455 | 
  456 |     // Switch to HAND tool first so Excalidraw layer goes pointer-events:none.
  457 |     await page.evaluate(() => {
  458 |       const w = window as unknown as AtlasdrawWindow;
  459 |       w.__atlasdraw__?.excalidrawAPI.setActiveTool({ type: "hand" });
  460 |     });
  461 |     await page.waitForTimeout(50);
  462 | 
  463 |     // Diagnostic: which element receives the wheel event at (300,300)?
  464 |     const wheelTarget = await page.evaluate(() => {
  465 |       const el = document.elementFromPoint(300, 300);
  466 |       const chain: string[] = [];
  467 |       let cur: Element | null = el;
  468 |       while (cur && chain.length < 6) {
  469 |         const cls = cur.className && typeof cur.className === "string"
  470 |           ? `.${cur.className.split(/\s+/).slice(0, 2).join(".")}`
  471 |           : "";
  472 |         chain.push(`${cur.tagName.toLowerCase()}${cls.slice(0, 50)}`);
  473 |         cur = cur.parentElement;
  474 |       }
  475 |       const w2 = window as unknown as AtlasdrawWindow;
  476 |       const tool = w2.__atlasdraw__?.excalidrawAPI.getAppState().activeTool.type;
  477 |       return { tool, chain: chain.join(" > ") };
  478 |     });
  479 |     console.log(`[5afc-wheel] tool=${wheelTarget.tool} elFromPt(300,300)=${wheelTarget.chain}`);
  480 | 
  481 |     const beforeZoom = await page.evaluate(() => {
  482 |       const m = (window as unknown as { __atlasdraw__?: { map: any } }).__atlasdraw__!.map;
  483 |       return (m as any).getZoom();
  484 |     });
  485 | 
  486 |     // Mouse wheel zoom IN at (300,300) — well away from any UI buttons.
  487 |     await page.mouse.move(300, 300);
  488 |     // MapLibre's default scrollZoom interprets wheel deltaY < 0 as zoom in.
  489 |     // Send several to trigger a noticeable zoom (one wheel tick is small).
  490 |     for (let i = 0; i < 5; i++) {
  491 |       await page.mouse.wheel(0, -120);
  492 |       await page.waitForTimeout(40);
  493 |     }
  494 |     // MapLibre's scrollZoom uses easing — wait for animation to settle.
  495 |     await page.waitForTimeout(500);
  496 | 
  497 |     const afterZoom = await page.evaluate(() => {
  498 |       const m = (window as unknown as { __atlasdraw__?: { map: any } }).__atlasdraw__!.map;
  499 |       return (m as any).getZoom();
  500 |     });
  501 |     console.log(`[5afc-wheel] zoom: ${beforeZoom.toFixed(2)} -> ${afterZoom.toFixed(2)}`);
  502 | 
  503 |     const pin2 = await getPinElement(page);
  504 |     expect(pin2, "pin should still exist").toBeDefined();
  505 |     const geo2 = pin2!.customData!.geo as { kind: "point"; lng: number; lat: number };
  506 | 
  507 |     // Pre-check: did the zoom level actually change?
  508 |     if (Math.abs(afterZoom - beforeZoom) < 0.1) {
  509 |       throw new Error(
  510 |         `wheel zoom did not change camera zoom (${beforeZoom} -> ${afterZoom}). ` +
  511 |           `Means wheel events were captured by an overlay (Excalidraw layer?) instead of MapLibre.`,
  512 |       );
  513 |     }
  514 | 
  515 |     expect(geo2.lng).toBe(geo1.lng);
  516 |     expect(geo2.lat).toBe(geo1.lat);
  517 | 
  518 |     const projected = await projectGeo(page, geo1.lng, geo1.lat);
  519 |     const driftX = pin2!.x - projected.x;
  520 |     const driftY = pin2!.y - projected.y;
  521 |     console.log(
  522 |       `[5afc-wheel] post: scene=(${pin2!.x.toFixed(1)},${pin2!.y.toFixed(1)}) projected=(${projected.x.toFixed(1)},${projected.y.toFixed(1)}) drift=(${driftX.toFixed(1)},${driftY.toFixed(1)})`,
  523 |     );
  524 |     expect(
  525 |       Math.abs(driftX),
  526 |       `pin drifted ${driftX.toFixed(1)}px in x from projected lat/lng after wheel zoom`,
  527 |     ).toBeLessThan(15);
  528 |     expect(
  529 |       Math.abs(driftY),
  530 |       `pin drifted ${driftY.toFixed(1)}px in y from projected lat/lng after wheel zoom`,
  531 |     ).toBeLessThan(15);
  532 |   });
  533 | 
  534 |   // The actual user-reported failure mode (atlasdraw-5afc): in DRAWING mode
  535 |   // (selection/rectangle/etc.), the Excalidraw layer is pointer-events:auto and
  536 |   // captures wheel events before MapLibre's scrollZoom listener can see them.
  537 |   // Result: scroll-to-zoom does nothing, annotations don't re-project, user
  538 |   // perceives them as drifting off their geographic anchor.
  539 |   //
  540 |   // Pre-fix expectation: this test fails because zoom stays at 12.
  541 |   // Post-fix expectation: useMapWheelRouter intercepts wheel in capture phase
  542 |   // and routes the zoom delta to map.easeTo regardless of which layer is on top.
```