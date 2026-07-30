// SPDX-License-Identifier: AGPL-3.0-only
//
// `SheetRail` — the single sidebar trigger rail in the Collar frame's right
// column — and its relationship to the real
// `registerSidebarTab → getSidebarTabs → DefaultSidebar` seam.
//
// Descended from `CollarSheetTabs.test.tsx`, the characterization suite
// written before the redesign. Cases that pinned genuinely-correct behaviour
// (addressing form, highlight derivation, the cross-seam open path) are kept.
// Cases that pinned the drift the redesign deletes are INVERTED, and say so.
// Two halves:
//
//  * "isolated" — `SheetRail` driven by a hand-rolled fake `excalidrawAPI`,
//    which is all the component consumes (`getSidebarTabs` +
//    `onSidebarTabsChange` + `onChange` + `toggleSidebar`).
//  * "unmocked cross-seam" — the REAL `<Excalidraw>` editor mounted next to
//    the REAL `SheetRail`, wired to the real imperative API and real
//    `registerSidebarTab`, with `hideDefaultSidebarTabTriggers` set exactly as
//    `MapEditor.tsx` sets it. Every other atlas-app test stubs
//    `@atlasdraw/excalidraw` out entirely, so this is the only place in the
//    app package where the registration seam is exercised for real. The
//    fork-side half of the same seam lives in
//    `packages/excalidraw/components/DefaultSidebar.projectTabs.test.tsx`.
//
// NOTE this file installs a few DOM shims locally (canvas 2d context,
// matchMedia, setPointerCapture). The atlas-app vitest project deliberately
// omits the engine's `setupTests.ts`, so mounting the real editor here needs
// them; keeping them file-local avoids changing shared setup for every other
// app test. `globals: false` in `apps/atlas-app/vitest.config.ts` is why
// describe/it/expect are imported, and why jest-dom matchers are unavailable
// (hence plain attribute assertions below).

import "vitest-canvas-mock";

import React, { useEffect, useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import {
  CANVAS_SEARCH_TAB,
  DEFAULT_SIDEBAR,
  DEFAULT_SIDEBAR_DOM_ID,
  LIBRARY_SIDEBAR_TAB,
} from "@atlasdraw/common";
import { Excalidraw } from "@atlasdraw/excalidraw";

import type {
  AppState,
  ExcalidrawImperativeAPI,
  ProjectSidebarTab,
  SidebarTabDescriptor,
} from "@atlasdraw/excalidraw/types";

import { SheetRail } from "../SheetRail";

beforeAll(() => {
  if (!window.matchMedia) {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }
  if (!HTMLElement.prototype.setPointerCapture) {
    HTMLElement.prototype.setPointerCapture = () => {};
  }
  // The editor's font pipeline constructs `FontFace` and reads `document.fonts`
  // during `initializeScene`; without these jsdom throws an unhandled
  // rejection that vitest reports as a run-level error.
  if (!("FontFace" in window)) {
    Object.defineProperty(window, "FontFace", {
      value: class {
        load() {}
      },
    });
  }
  if (!document.fonts) {
    Object.defineProperty(document, "fonts", {
      value: {
        load: () => Promise.resolve([]),
        check: () => true,
        has: () => true,
        add: () => {},
      },
    });
  }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Half 1 — the rail in isolation
// ---------------------------------------------------------------------------

const DEFAULT_FAKE_TABS: readonly SidebarTabDescriptor[] = [
  {
    name: CANVAS_SEARCH_TAB,
    label: "Find on canvas",
    icon: <svg data-testid="icon-search" />,
    stock: true,
  },
  {
    name: LIBRARY_SIDEBAR_TAB,
    label: "Library",
    icon: <svg data-testid="icon-library" />,
    stock: true,
  },
  {
    name: "layers",
    label: "Layers",
    icon: <svg data-testid="icon-layers" />,
    stock: false,
  },
  {
    name: "comments",
    label: "Comments",
    icon: <svg data-testid="icon-comments" />,
    stock: false,
  },
];

/**
 * Minimal stand-in for the four API members `SheetRail` consumes.
 *
 * `getSidebarTabs`/`onSidebarTabsChange` model the fork's real contract: the
 * snapshot reference is stable until the list mutates (a fresh array per call
 * would make `useSyncExternalStore` re-render forever). `emit` drives the
 * `onChange` subscription the rail uses for its open-tab state.
 */
const makeFakeAPI = (
  initialTabs: readonly SidebarTabDescriptor[] = DEFAULT_FAKE_TABS,
) => {
  const stateListeners = new Set<
    (elements: never[], appState: AppState) => void
  >();
  const tabListeners = new Set<() => void>();
  let tabs = initialTabs;
  const toggleSidebar = vi.fn();

  const api = {
    onChange: (cb: (elements: never[], appState: AppState) => void) => {
      stateListeners.add(cb);
      return () => stateListeners.delete(cb);
    },
    toggleSidebar,
    getSidebarTabs: () => tabs,
    onSidebarTabsChange: (cb: () => void) => {
      tabListeners.add(cb);
      return () => tabListeners.delete(cb);
    },
  } as unknown as ExcalidrawImperativeAPI;

  return {
    api,
    toggleSidebar,
    emit: (openSidebar: AppState["openSidebar"]) =>
      act(() => {
        stateListeners.forEach((cb) =>
          cb([], { openSidebar } as unknown as AppState),
        );
      }),
    /** Models `registerSidebarTab` landing a new entry on the fork side. */
    appendTab: (tab: SidebarTabDescriptor) =>
      act(() => {
        tabs = [...tabs, tab];
        tabListeners.forEach((cb) => cb());
      }),
  };
};

/** Accessible names of the rail's buttons, in DOM order. */
const railNames = (root: HTMLElement): string[] =>
  Array.from(
    root.querySelectorAll<HTMLElement>("[data-testid^=sheet-rail-]"),
  ).map((btn) => btn.getAttribute("aria-label") ?? "");

describe("SheetRail — driven by the API tab list", () => {
  it("renders one trigger per API tab, in API order, search included", () => {
    const { api } = makeFakeAPI();
    const { container } = render(<SheetRail excalidrawAPI={api} />);

    // WAS (CollarSheetTabs): `toEqual(["Layers", "Comments", "Library"])` plus
    // an explicit assertion that no `search` trigger existed. That pinned the
    // drift — `TABS` was a hardcoded 3-entry literal, so in collar mode (where
    // LayerUI hides the floating sidebar trigger) canvas Search had no
    // affordance at all. The rail is now derived from `getSidebarTabs()`, the
    // same list `DefaultSidebar` renders, so all four tabs are reachable and
    // stock tabs come first because the fork hardcodes them first.
    expect(railNames(container)).toEqual([
      "Find on canvas",
      "Library",
      "Layers",
      "Comments",
    ]);
    expect(screen.getByTestId(`sheet-rail-${CANVAS_SEARCH_TAB}`)).toBeTruthy();
  });

  it("renders nothing until the API exists", () => {
    const { container } = render(<SheetRail excalidrawAPI={null} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when the API reports no tabs", () => {
    const { api } = makeFakeAPI([]);
    const { container } = render(<SheetRail excalidrawAPI={api} />);
    expect(container.innerHTML).toBe("");
  });

  it("toggles the tab as a tab of DEFAULT_SIDEBAR, never as a sidebar name", () => {
    const { api, toggleSidebar } = makeFakeAPI();
    render(<SheetRail excalidrawAPI={api} />);

    fireEvent.click(screen.getByTestId("sheet-rail-layers"));

    // the correct addressing form. The gotcha documented in
    // `AssetLibraryPanel.tsx`'s header is that `{name: "layers"}` would open a
    // sidebar that does not exist — see the fork-side suite, which pins that
    // it silently returns `true` and renders nothing.
    expect(toggleSidebar).toHaveBeenCalledWith({
      name: DEFAULT_SIDEBAR.name,
      tab: "layers",
    });
    expect(toggleSidebar).not.toHaveBeenCalledWith({ name: "layers" });
  });

  it("derives its open state from appState.openSidebar, and ignores other sidebars", async () => {
    const { api, emit } = makeFakeAPI();
    render(<SheetRail excalidrawAPI={api} />);

    const expanded = (tab: string) =>
      screen.getByTestId(`sheet-rail-${tab}`).getAttribute("aria-expanded");

    // nothing expanded before the first appState commit
    expect(expanded("layers")).toBe("false");

    await emit({ name: DEFAULT_SIDEBAR.name, tab: "layers" });
    expect(expanded("layers")).toBe("true");
    expect(expanded("comments")).toBe("false");

    // a different sidebar *name* clears the highlight even if the tab matches
    await emit({ name: "layers" } as unknown as AppState["openSidebar"]);
    expect(expanded("layers")).toBe("false");

    // KEPT AS CHARACTERIZATION: the DefaultSidebar can still be open with no
    // tab at all (`toggleSidebar({ name })`), and then no rail trigger is
    // expanded even though the sidebar is visibly open. That is a fork-side
    // gap (`SidebarTabs` passes `value={undefined}` to Radix rather than
    // falling back to `DEFAULT_SIDEBAR.defaultTab`) and out of this step's
    // scope — see the fork-side suite, section 3.
    await emit({ name: DEFAULT_SIDEBAR.name });
    for (const tab of [
      CANVAS_SEARCH_TAB,
      LIBRARY_SIDEBAR_TAB,
      "layers",
      "comments",
    ]) {
      expect(expanded(tab)).toBe("false");
    }
  });

  it("picks up a tab registered after mount", async () => {
    const { api, appendTab } = makeFakeAPI();
    const { container } = render(<SheetRail excalidrawAPI={api} />);

    await appendTab({
      name: "sheet",
      label: "Sheet",
      icon: <svg data-testid="icon-sheet" />,
      stock: false,
    });

    // INVERTED. WAS: "is blind to tabs registered through the API" — the old
    // rail subscribed to `onChange` (appState) only, and
    // `useProjectSidebarTabs` is context-backed and unreachable from outside
    // the editor tree, so a registration was invisible to it. The rail now
    // subscribes to the same listener set `DefaultSidebar` does.
    await waitFor(() => {
      expect(railNames(container)).toEqual([
        "Find on canvas",
        "Library",
        "Layers",
        "Comments",
        "Sheet",
      ]);
    });
    expect(screen.getByTestId("sheet-rail-sheet")).toBeTruthy();
  });
});

describe("SheetRail — keyboard + ARIA", () => {
  it("is a vertical toolbar of icon-only toggles, each naming the panel it controls", () => {
    const { api } = makeFakeAPI();
    const { container } = render(<SheetRail excalidrawAPI={api} />);

    // DELIBERATELY still not `role="tab"`. The old suite pinned that as a
    // defect ("the rail should BE the sidebar's tablist"), which is not
    // achievable honestly: the rail renders in the app's React tree
    // (CollarShell's `tabs` slot) and the panels render inside the editor's, so
    // no tablist can own both. A `role="toolbar"` of toggle buttons is the
    // truthful widget — and the duplicate-tablist problem is gone for real,
    // because the sidebar's own trigger row is now suppressed rather than
    // competing (see cross-seam below).
    const toolbar = container.querySelector<HTMLElement>("[role=toolbar]")!;
    expect(toolbar).not.toBe(null);
    expect(toolbar.getAttribute("aria-orientation")).toBe("vertical");
    expect(toolbar.getAttribute("aria-label")).toBe("Sheet panel");
    expect(container.querySelector("[role=tablist]")).toBe(null);
    expect(container.querySelector("[role=tab]")).toBe(null);

    const buttons = Array.from(
      container.querySelectorAll<HTMLElement>("[data-testid^=sheet-rail-]"),
    );
    expect(buttons).toHaveLength(4);
    for (const btn of buttons) {
      expect(btn.tagName).toBe("BUTTON");
      expect(btn.getAttribute("type")).toBe("button");
      expect(btn.hasAttribute("aria-expanded")).toBe(true);
      // At rest the sidebar is closed, so its island is not in the DOM and
      // there is nothing for `aria-controls` to point at — see the dedicated
      // test below.
      expect(btn.hasAttribute("aria-controls")).toBe(false);
      // icon-only, so the label must be the accessible name and the glyph must
      // be hidden from the a11y tree
      expect(btn.textContent).toBe("");
      expect(btn.getAttribute("aria-label")).toBeTruthy();
      expect(btn.querySelector("[aria-hidden=true] svg")).not.toBe(null);
    }
  });

  // REGRESSION: `aria-controls` was emitted unconditionally. `Sidebar` returns
  // null while closed, so in the resting state — the common state — every
  // button pointed at an id that resolved to nothing. A dangling IDREF is worse
  // than no reference: `aria-expanded` already carries the state.
  it("only references the sidebar island while the sidebar is actually open", async () => {
    const { api, emit } = makeFakeAPI();
    const { container } = render(<SheetRail excalidrawAPI={api} />);

    const railButtons = () =>
      Array.from(
        container.querySelectorAll<HTMLElement>("[data-testid^=sheet-rail-]"),
      );

    // closed: no reference at all
    for (const btn of railButtons()) {
      expect(btn.hasAttribute("aria-controls")).toBe(false);
      expect(btn.getAttribute("aria-expanded")).toBe("false");
    }

    // open: every button points at the island id
    await emit({ name: DEFAULT_SIDEBAR.name, tab: "layers" });
    for (const btn of railButtons()) {
      expect(btn.getAttribute("aria-controls")).toBe(DEFAULT_SIDEBAR_DOM_ID);
    }
    expect(
      screen.getByTestId("sheet-rail-layers").getAttribute("aria-expanded"),
    ).toBe("true");

    // open with no tab selected — the sidebar island still exists, so the
    // reference must stay even though nothing is expanded
    await emit({ name: DEFAULT_SIDEBAR.name });
    for (const btn of railButtons()) {
      expect(btn.getAttribute("aria-controls")).toBe(DEFAULT_SIDEBAR_DOM_ID);
      expect(btn.getAttribute("aria-expanded")).toBe("false");
    }

    // a *different* sidebar open is not our island
    await emit({ name: "someOtherSidebar", tab: "x" });
    for (const btn of railButtons()) {
      expect(btn.hasAttribute("aria-controls")).toBe(false);
    }

    // back to closed
    await emit(null);
    for (const btn of railButtons()) {
      expect(btn.hasAttribute("aria-controls")).toBe(false);
    }
  });

  it("uses a roving tabindex and moves focus with arrow keys", () => {
    const { api } = makeFakeAPI();
    const { container } = render(<SheetRail excalidrawAPI={api} />);

    const buttons = Array.from(
      container.querySelectorAll<HTMLElement>("[data-testid^=sheet-rail-]"),
    );

    // INVERTED. WAS: "puts all three triggers in the tab order (no roving
    // tabindex) and ignores arrow keys" — plain buttons with no `tabindex`, so
    // an N-tab rail was N tab stops and arrows did nothing, the opposite
    // keyboard model from the sidebar's own trigger row 34px away.
    expect(
      buttons.filter((b) => b.getAttribute("tabindex") === "0"),
    ).toHaveLength(1);
    expect(buttons[0].getAttribute("tabindex")).toBe("0");

    act(() => buttons[0].focus());
    fireEvent.keyDown(buttons[0], { key: "ArrowDown" });
    expect(document.activeElement).toBe(buttons[1]);
    expect(buttons[1].getAttribute("tabindex")).toBe("0");
    expect(buttons[0].getAttribute("tabindex")).toBe("-1");

    // wraps at both ends, and Home/End jump
    fireEvent.keyDown(buttons[1], { key: "ArrowUp" });
    expect(document.activeElement).toBe(buttons[0]);
    fireEvent.keyDown(buttons[0], { key: "ArrowUp" });
    expect(document.activeElement).toBe(buttons[buttons.length - 1]);
    fireEvent.keyDown(buttons[buttons.length - 1], { key: "Home" });
    expect(document.activeElement).toBe(buttons[0]);
    fireEvent.keyDown(buttons[0], { key: "End" });
    expect(document.activeElement).toBe(buttons[buttons.length - 1]);
  });

  it("activates on click (Enter/Space via the native button path)", () => {
    const { api, toggleSidebar } = makeFakeAPI();
    const { container } = render(<SheetRail excalidrawAPI={api} />);

    const first = container.querySelector<HTMLElement>(
      "[data-testid^=sheet-rail-]",
    )!;
    fireEvent.click(first);
    expect(toggleSidebar).toHaveBeenCalledWith({
      name: DEFAULT_SIDEBAR.name,
      tab: CANVAS_SEARCH_TAB,
    });
  });
});

// ---------------------------------------------------------------------------
// Half 2 — cross-seam, with the sidebar NOT mocked
// ---------------------------------------------------------------------------

/**
 * jsdom reports a 0×0 rect for every element, which pins the editor to the
 * `phone` form factor and changes the sidebar shell. The fork's own tests use
 * `withExcalidrawDimensions`; that helper lives under
 * `packages/excalidraw/tests/`, which atlas-app's tsconfig cannot import (it
 * resolves `@atlasdraw/excalidraw/*` to built .d.ts, and tests aren't part of
 * the emitted types). So mock the rect locally, for one test at a time.
 */
const withDesktopDimensions = (width = 1920, height = 1080) => {
  const original = window.HTMLDivElement.prototype.getBoundingClientRect;
  window.HTMLDivElement.prototype.getBoundingClientRect = function () {
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      bottom: height,
      right: width,
      width,
      height,
      toJSON: () => ({}),
    } as DOMRect;
  };
  return () => {
    window.HTMLDivElement.prototype.getBoundingClientRect = original;
  };
};

/**
 * Mounts the real editor + the real rail, registering `tabs` the way
 * `MapEditor.tsx` does: an effect keyed on the API that returns the
 * unregister function. `hideDefaultSidebarTabTriggers` is set here for the
 * same reason MapEditor sets it — the rail is the only trigger surface.
 */
const renderCrossSeam = async (tabs: readonly ProjectSidebarTab[]) => {
  let apiRef: ExcalidrawImperativeAPI | null = null;

  const Registrar = ({ api }: { api: ExcalidrawImperativeAPI }) => {
    useEffect(() => {
      const unregisters = tabs.map((tab) => api.registerSidebarTab(tab));
      return () => unregisters.forEach((unregister) => unregister());
    }, [api]);
    return null;
  };

  const Harness = () => {
    const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
    return (
      <>
        <Excalidraw
          onExcalidrawAPI={(next) => {
            apiRef = next;
            setApi(next);
          }}
          initialData={{ appState: { openSidebar: null } }}
          hideDefaultSidebarTabTriggers
        />
        {api && <Registrar api={api} />}
        <SheetRail excalidrawAPI={api} />
      </>
    );
  };

  const result = render(<Harness />);

  await waitFor(() => {
    expect(apiRef).not.toBe(null);
    expect(result.container.querySelector("canvas.static")).not.toBe(null);
  });
  // let the registration effect + initial scene load settle
  await act(async () => {});

  return { ...result, getApi: () => apiRef! };
};

describe("SheetRail × real DefaultSidebar (unmocked cross-seam)", () => {
  it("a rail trigger opens the registered tab's real body in the real sidebar", async () => {
    const restore = withDesktopDimensions();
    try {
      const { container } = await renderCrossSeam([
        {
          name: "layers",
          label: "Layers",
          icon: <svg />,
          content: <div data-testid="real-layers-body">layers</div>,
        },
      ]);

      // sidebar starts closed — no shell, no panel
      expect(container.querySelector(".default-sidebar")).toBe(null);

      fireEvent.click(screen.getByTestId("sheet-rail-layers"));

      await waitFor(() => {
        // the real DefaultSidebar mounted, showing the registered body
        expect(container.querySelector(".default-sidebar")).not.toBe(null);
        expect(
          container.querySelector('[data-testid="real-layers-body"]'),
        ).not.toBe(null);
      });

      expect(
        screen.getByTestId("sheet-rail-layers").getAttribute("aria-expanded"),
      ).toBe("true");

      // NEW: `aria-controls` resolves to a real element — the sidebar island
      // carries `DEFAULT_SIDEBAR_DOM_ID`.
      expect(container.querySelector(`#${DEFAULT_SIDEBAR_DOM_ID}`)).toBe(
        container.querySelector(".default-sidebar"),
      );

      // WAS: "both rails agree about which tab is active", asserting
      // `aria-selected="true"` on `sidebar-tab-trigger-layers`. There is no
      // second rail to agree with any more — `hideDefaultSidebarTabTriggers`
      // removes the sidebar's own trigger row, which is what makes four tabs
      // fit at all (that row is `repeat(auto-fit, minmax(0, 1fr))` inside a
      // 294px header and rendered "Layersomments" with four labelled tabs).
      expect(container.querySelector("[role=tablist]")).toBe(null);
      expect(
        container.querySelector('[data-testid="sidebar-tab-trigger-layers"]'),
      ).toBe(null);
      // ...and the panel still routes, because Radix `Tabs.Content` keys off
      // the Root's value, not off the presence of a trigger.
      expect(container.querySelector("[role=tabpanel]:not([hidden])")).not.toBe(
        null,
      );

      // REGRESSION: with the trigger row gone, `RadixTabs.Content`'s
      // `aria-labelledby` pointed at a trigger that no longer exists, leaving
      // the panel with NO accessible name — a regression against both rails
      // this replaced, and one `aria-controls` on the rail does not fix. The
      // panel is now named from the tab's own label. `getByRole(name:)` runs
      // the accessible-name computation, so it fails if the name is missing.
      expect(screen.getByRole("tabpanel", { name: "Layers" })).toBe(
        container.querySelector("[role=tabpanel]:not([hidden])"),
      );
      expect(
        container
          .querySelector("[role=tabpanel]:not([hidden])")!
          .hasAttribute("aria-labelledby"),
      ).toBe(false);

      // clicking the same rail trigger again closes the sidebar (toggle)
      fireEvent.click(screen.getByTestId("sheet-rail-layers"));
      await waitFor(() => {
        expect(container.querySelector(".default-sidebar")).toBe(null);
      });
    } finally {
      restore();
    }
  });

  it("shows the stock search + library tabs alongside registered ones", async () => {
    const restore = withDesktopDimensions();
    try {
      const { container } = await renderCrossSeam([
        {
          name: "layers",
          label: "Layers",
          icon: <svg />,
          content: <div data-testid="real-layers-body">layers</div>,
        },
      ]);

      // NEW. The old rail omitted `search` entirely and, with the floating
      // trigger hidden in collar mode, canvas Search was reachable only by ⌘F
      // or the ⌘K palette. The rail is the full tab list now — the stock
      // labels come from the fork's own i18n, not from atlas-side literals.
      expect(railNames(container)).toEqual([
        "Find on canvas",
        "Library",
        "Layers",
      ]);

      fireEvent.click(screen.getByTestId(`sheet-rail-${LIBRARY_SIDEBAR_TAB}`));
      await waitFor(() => {
        expect(container.querySelector(".default-sidebar")).not.toBe(null);
        // the stock LibraryMenu body
        expect(
          container.querySelector(
            `[role=tabpanel][data-testid="${LIBRARY_SIDEBAR_TAB}"]:not([hidden])`,
          ),
        ).not.toBe(null);
      });
    } finally {
      restore();
    }
  });

  it("a tab registered after mount appears in the rail", async () => {
    const restore = withDesktopDimensions();
    try {
      const { container, getApi } = await renderCrossSeam([
        {
          name: "layers",
          label: "Layers",
          icon: <svg />,
          content: <div data-testid="real-layers-body">layers</div>,
        },
      ]);

      fireEvent.click(screen.getByTestId("sheet-rail-layers"));
      await waitFor(() => {
        expect(container.querySelector(".default-sidebar")).not.toBe(null);
      });

      await act(async () => {
        getApi().registerSidebarTab({
          name: "sheet",
          label: "Sheet",
          icon: <svg />,
          content: <div data-testid="real-sheet-body">sheet</div>,
        });
      });

      // INVERTED. WAS: "a tab registered after mount appears in the sidebar's
      // tablist but NOT in the collar rail" — the whole point of the redesign.
      // The rail and the sidebar now read the same list off the same listener
      // set, so a late registration is reachable from the frame.
      await waitFor(() => {
        expect(screen.getByTestId("sheet-rail-sheet")).toBeTruthy();
      });
      expect(railNames(container)).toEqual([
        "Find on canvas",
        "Library",
        "Layers",
        "Sheet",
      ]);

      fireEvent.click(screen.getByTestId("sheet-rail-sheet"));
      await waitFor(() => {
        expect(
          container.querySelector('[data-testid="real-sheet-body"]'),
        ).not.toBe(null);
      });
    } finally {
      restore();
    }
  });

  it("offers no trigger for a tab nobody registered", async () => {
    const restore = withDesktopDimensions();
    try {
      const { container } = await renderCrossSeam([]);

      // INVERTED. WAS: "a collar trigger for an unregistered tab opens the
      // sidebar on an empty tab" — the old rail's truth was a source literal,
      // so `collar-tab-layers` existed with nothing behind it and opened a
      // blank sidebar. Its own `// Expected:` note asked for exactly this.
      expect(screen.queryByTestId("sheet-rail-layers")).toBe(null);
      expect(railNames(container)).toEqual(["Find on canvas", "Library"]);
    } finally {
      restore();
    }
  });
});
