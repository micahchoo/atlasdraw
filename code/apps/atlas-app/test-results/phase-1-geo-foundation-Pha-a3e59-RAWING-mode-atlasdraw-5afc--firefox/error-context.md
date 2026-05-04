# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: phase-1-geo-foundation.spec.ts >> Phase 1 — geo foundation stays glued >> pin stays glued during wheel zoom in DRAWING mode (atlasdraw-5afc)
- Location: e2e/phase-1-geo-foundation.spec.ts:543:7

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
  543 |   test("pin stays glued during wheel zoom in DRAWING mode (atlasdraw-5afc)", async ({
  544 |     page,
  545 |   }) => {
  546 |     await page.goto("/");
> 547 |     await expect(page.getByTestId("pin-tool-button")).toBeVisible();
      |                                                       ^ Error: expect(locator).toBeVisible() failed
  548 |     await waitForAtlasdrawReady(page);
  549 | 
  550 |     await page.getByTestId("pin-tool-button").click();
  551 |     await page.mouse.move(640, 400);
  552 |     await page.mouse.down();
  553 |     await page.mouse.up();
  554 |     await expect(page.getByTestId("atlas-tool-overlay")).toBeHidden();
  555 | 
  556 |     // Force selection mode (the default after PinTool one-shot reset, but
  557 |     // make it explicit so a future tool-state change doesn't silently break
  558 |     // this test's premise).
  559 |     await page.evaluate(() => {
  560 |       const w = window as unknown as AtlasdrawWindow;
  561 |       w.__atlasdraw__?.excalidrawAPI.setActiveTool({ type: "selection" });
  562 |     });
  563 |     await page.waitForTimeout(50);
  564 | 
  565 |     const pin1 = await getPinElement(page);
  566 |     const geo1 = pin1!.customData!.geo as { kind: "point"; lng: number; lat: number };
  567 | 
  568 |     const beforeZoom = await page.evaluate(() => {
  569 |       const m = (window as unknown as { __atlasdraw__?: { map: any } }).__atlasdraw__!.map;
  570 |       return (m as any).getZoom();
  571 |     });
  572 | 
  573 |     // Wheel zoom at a point clearly inside the map area but not on the Pin button.
  574 |     await page.mouse.move(300, 300);
  575 |     for (let i = 0; i < 5; i++) {
  576 |       await page.mouse.wheel(0, -120);
  577 |       await page.waitForTimeout(40);
  578 |     }
  579 |     await page.waitForTimeout(500);
  580 | 
  581 |     const afterZoom = await page.evaluate(() => {
  582 |       const m = (window as unknown as { __atlasdraw__?: { map: any } }).__atlasdraw__!.map;
  583 |       return (m as any).getZoom();
  584 |     });
  585 |     console.log(`[5afc-drawing-wheel] zoom: ${beforeZoom.toFixed(2)} -> ${afterZoom.toFixed(2)}`);
  586 | 
  587 |     expect(
  588 |       afterZoom - beforeZoom,
  589 |       `wheel zoom in selection mode must change camera zoom (${beforeZoom} -> ${afterZoom}) — ` +
  590 |         `if 0, the wheel router fix is missing/regressed`,
  591 |     ).toBeGreaterThan(0.3);
  592 | 
  593 |     const pin2 = await getPinElement(page);
  594 |     const geo2 = pin2!.customData!.geo as { kind: "point"; lng: number; lat: number };
  595 |     expect(geo2.lng).toBe(geo1.lng);
  596 |     expect(geo2.lat).toBe(geo1.lat);
  597 | 
  598 |     const projected = await projectGeo(page, geo1.lng, geo1.lat);
  599 |     const driftX = pin2!.x - projected.x;
  600 |     const driftY = pin2!.y - projected.y;
  601 |     console.log(`[5afc-drawing-wheel] drift=(${driftX.toFixed(1)},${driftY.toFixed(1)})`);
  602 |     expect(Math.abs(driftX), `drawing-mode wheel drift x = ${driftX.toFixed(1)}`).toBeLessThan(15);
  603 |     expect(Math.abs(driftY), `drawing-mode wheel drift y = ${driftY.toFixed(1)}`).toBeLessThan(15);
  604 |   });
  605 | });
  606 | 
```