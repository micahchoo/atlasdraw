// SPDX-License-Identifier: AGPL-3.0-only
//
// REGRESSION SUITE — collar-mode LEGEND placement against the right sidebar.
//
// The legend renders inside `.layer-ui__wrapper`, which narrows its OWN right
// edge to the sidebar's left edge when the sidebar is docked. So there are two
// different occlusion problems wearing one name:
//
//   undocked (overlay) — the sidebar floats over the full-width wrapper, from a
//     higher stacking context (--zIndex-ui-library: 120 vs the legend's 4), so
//     the legend is *buried*: select a shape with Layers open and its styling UI
//     is invisible. The legend has to step inboard itself, via
//     `.App-collar-legend--beside-sidebar`.
//   docked — the wrapper has already stepped inboard on the legend's behalf.
//     Applying the class here shifts it a SECOND ~302px. Measured in Chromium
//     at 1600×1000: legend at x=715..947 where it belonged at x=1017..1249,
//     i.e. 604px of displacement, with the sidebar at x=1265..1559.
//
// So the invariant is a pairing: the offset class and the wrapper's own
// narrowing are mutually exclusive, and exactly one of them is in effect
// whenever the default sidebar is open. Both firing at once was the bug.
//
// Why the assertions read `.sidebar--docked` rather than the wrapper's width:
// the wrapper's narrowing is `width: calc(100% - var(--right-sidebar-width))`,
// and jsdom's CSS parser rejects `var()` inside `calc()` — the style attribute
// never materializes, so it is not observable here. `.sidebar--docked` is set
// from the same `docked` value that drives `isSidebarDockedAtom`, and these
// tests run at 1920×1080 where `canFitSidebar` is true, so
// `.sidebar--docked` ⇔ the wrapper narrowed. The pixel geometry itself is
// checked in the browser (numbers above).
//
// Guaranteed repro for the docked case: the `search` tab force-docks
// (`DefaultSidebar`'s `isForceDocked`), so selecting a shape and opening search
// is enough — no dock-button click needed.

import React from "react";

import { CANVAS_SEARCH_TAB, DEFAULT_SIDEBAR } from "@atlasdraw/common";

import { Excalidraw } from "../index";
import { API } from "../tests/helpers/api";
import {
  act,
  render,
  waitFor,
  withExcalidrawDimensions,
} from "../tests/test-utils";

import type { ExcalidrawImperativeAPI } from "../types";

const { h } = window;

const BESIDE_SIDEBAR_CLASS = "App-collar-legend--beside-sidebar";

const legend = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('[data-testid="collar-legend"]');

/** True when the wrapper around the legend has narrowed itself — see header. */
const isUIShrunkForSidebar = (container: HTMLElement) =>
  container.querySelector(".sidebar.sidebar--docked") !== null;

const isLegendOffset = (container: HTMLElement) =>
  legend(container)!.classList.contains(BESIDE_SIDEBAR_CLASS);

/**
 * Renders the editor in collar mode (`collarToolbarTarget` set + desktop form
 * factor) with one selected rectangle, so `renderCollarLegend` is live.
 */
const UNDOCKED_TAB = "layers";

const renderCollarWithSelection = async () => {
  const collarToolbarTarget = document.createElement("div");
  document.body.appendChild(collarToolbarTarget);

  let api: ExcalidrawImperativeAPI | null = null;
  const renderResult = await render(
    <Excalidraw
      collarToolbarTarget={collarToolbarTarget}
      onExcalidrawAPI={(nextApi) => {
        api = nextApi;
      }}
    />,
  );

  // A host-registered tab, so the undocked case does not have to go through
  // the stock `library` tab (whose async item load fires state updates outside
  // act() and buries the assertion in warnings). This is also the real repro:
  // atlas-app's Layers tab.
  await act(async () => {
    api!.registerSidebarTab({
      name: UNDOCKED_TAB,
      label: "Layers",
      content: <div data-testid="layers-body">layers</div>,
    });
  });

  const rect = API.createElement({ type: "rectangle", x: 0, y: 0 });
  act(() => {
    API.setElements([rect]);
    API.setAppState({ selectedElementIds: { [rect.id]: true } });
  });

  return renderResult;
};

const openSidebar = async (tab: string) => {
  await act(async () => {
    h.app.toggleSidebar({ name: DEFAULT_SIDEBAR.name, tab, force: true });
  });
  await act(async () => {});
};

describe("collar LEGEND placement vs. the right sidebar", () => {
  it("does NOT offset the legend when the sidebar is docked — the wrapper already did", async () => {
    const { container } = await renderCollarWithSelection();

    await withExcalidrawDimensions({ width: 1920, height: 1080 }, async () => {
      // the `search` tab force-docks — the reported repro exactly
      await openSidebar(CANVAS_SEARCH_TAB);

      await waitFor(() => {
        expect(isUIShrunkForSidebar(container)).toBe(true);
      });
      expect(legend(container)).not.toBe(null);
      expect(isLegendOffset(container)).toBe(false);
    });
  });

  it("DOES offset the legend when the sidebar is undocked — nothing else moved out of its way", async () => {
    const { container } = await renderCollarWithSelection();

    await withExcalidrawDimensions({ width: 1920, height: 1080 }, async () => {
      expect(h.state.defaultSidebarDockedPreference).toBe(false);
      await openSidebar(UNDOCKED_TAB);

      await waitFor(() => {
        expect(legend(container)).not.toBe(null);
        expect(isLegendOffset(container)).toBe(true);
      });
      // the overlay sidebar leaves the wrapper full-width
      expect(isUIShrunkForSidebar(container)).toBe(false);
    });
  });

  it("offsets nothing when the sidebar is closed", async () => {
    const { container } = await renderCollarWithSelection();

    await withExcalidrawDimensions({ width: 1920, height: 1080 }, async () => {
      expect(h.state.openSidebar).toBe(null);
      expect(legend(container)).not.toBe(null);
      expect(isLegendOffset(container)).toBe(false);
      expect(isUIShrunkForSidebar(container)).toBe(false);
    });
  });

  // The bug in one line: the offset class and the wrapper narrowing were
  // computed from two different conditions, so both fired and the offsets
  // summed. Walking undocked → docked → undocked also covers the transition,
  // which is where a stale `isSidebarDockedAtom` would show up.
  it("never applies the offset class and the wrapper narrowing at the same time", async () => {
    const { container } = await renderCollarWithSelection();

    await withExcalidrawDimensions({ width: 1920, height: 1080 }, async () => {
      for (const tab of [UNDOCKED_TAB, CANVAS_SEARCH_TAB, UNDOCKED_TAB]) {
        await openSidebar(tab);

        const offset = isLegendOffset(container);
        const narrowed = isUIShrunkForSidebar(container);
        // never both (the ~604px double shift)...
        expect(offset && narrowed).toBe(false);
        // ...and never neither (the original burying)
        expect(offset || narrowed).toBe(true);
      }
    });
  });
});
