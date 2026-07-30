// SPDX-License-Identifier: AGPL-3.0-only
//
// CHARACTERIZATION SUITE — `CollarSheetTabs`, the second (hardcoded) sidebar
// trigger rail, and its relationship to the real
// `registerSidebarTab → useProjectSidebarTabs → DefaultSidebar` seam.
//
// Written as a safety net before the right-sidebar redesign. Two halves:
//
//  * "hardcoded rail" — `CollarSheetTabs` driven by a hand-rolled fake
//    `excalidrawAPI`, which is all the component actually consumes
//    (`onChange` + `toggleSidebar`).
//  * "unmocked cross-seam" — the REAL `<Excalidraw>` editor mounted next to
//    the REAL `CollarSheetTabs`, wired to the real imperative API and real
//    `registerSidebarTab`. Every other atlas-app test stubs
//    `@atlasdraw/excalidraw` out entirely, so this is the only place in the
//    app package where the registration seam is exercised for real. The
//    fork-side half of the same seam lives in
//    `packages/excalidraw/components/DefaultSidebar.projectTabs.test.tsx`.
//
// These tests pin CURRENT behaviour, including behaviour that looks wrong.
// `// CHARACTERIZATION:` comments say what would be expected instead.
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

import { CANVAS_SEARCH_TAB, DEFAULT_SIDEBAR } from "@atlasdraw/common";
import { Excalidraw } from "@atlasdraw/excalidraw";

import type {
  AppState,
  ExcalidrawImperativeAPI,
  ProjectSidebarTab,
} from "@atlasdraw/excalidraw/types";

import { CollarSheetTabs } from "../CollarSheetTabs";

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
// Half 1 — the hardcoded rail, in isolation
// ---------------------------------------------------------------------------

/**
 * Minimal stand-in for the two API members `CollarSheetTabs` consumes.
 * `emit` drives the `onChange` subscription the component uses to derive its
 * open-tab highlight.
 */
const makeFakeAPI = () => {
  const listeners = new Set<(elements: never[], appState: AppState) => void>();
  const toggleSidebar = vi.fn();
  const registerSidebarTab = vi.fn(() => () => {});
  const api = {
    onChange: (cb: (elements: never[], appState: AppState) => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    toggleSidebar,
    registerSidebarTab,
  } as unknown as ExcalidrawImperativeAPI;

  return {
    api,
    toggleSidebar,
    registerSidebarTab,
    emit: (openSidebar: AppState["openSidebar"]) =>
      act(() => {
        listeners.forEach((cb) =>
          cb([], { openSidebar } as unknown as AppState),
        );
      }),
  };
};

/** Visible labels of the collar rail's buttons, in DOM order. */
const railLabels = (root: HTMLElement): string[] =>
  Array.from(root.querySelectorAll<HTMLElement>("[data-testid^=collar-tab-]"))
    .map((btn) => btn.textContent ?? "")
    .filter(Boolean);

describe("CollarSheetTabs — hardcoded rail (characterization)", () => {
  it("renders triggers for exactly [layers, comments, library], in that order", () => {
    const { api } = makeFakeAPI();
    const { container } = render(<CollarSheetTabs excalidrawAPI={api} />);

    expect(railLabels(container)).toEqual(["Layers", "Comments", "Library"]);
    for (const tab of ["layers", "comments", "library"]) {
      expect(screen.getByTestId(`collar-tab-${tab}`)).toBeTruthy();
    }

    // CHARACTERIZATION: the rail has already drifted from the sidebar it
    // drives. `DefaultSidebar` renders a `search` tab (CANVAS_SEARCH_TAB)
    // first, but `CollarSheetTabs.TABS` is a hardcoded 3-entry literal with no
    // `search` entry — so in collar mode (where LayerUI hides the floating
    // sidebar trigger) canvas Search has no affordance at all.
    // Expected: the rail should be derived from the same tab list the sidebar
    // renders, not hand-maintained alongside it.
    expect(screen.queryByTestId(`collar-tab-${CANVAS_SEARCH_TAB}`)).toBe(null);
    expect(railLabels(container)).not.toContain("Search");
  });

  it("renders nothing until the API exists", () => {
    const { container } = render(<CollarSheetTabs excalidrawAPI={null} />);
    expect(container.innerHTML).toBe("");
  });

  it("toggles the tab as a tab of DEFAULT_SIDEBAR, never as a sidebar name", () => {
    const { api, toggleSidebar } = makeFakeAPI();
    render(<CollarSheetTabs excalidrawAPI={api} />);

    fireEvent.click(screen.getByTestId("collar-tab-layers"));

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

  it("derives its highlight from appState.openSidebar, and ignores other sidebars", async () => {
    const { api, emit } = makeFakeAPI();
    render(<CollarSheetTabs excalidrawAPI={api} />);

    const expanded = (tab: string) =>
      screen.getByTestId(`collar-tab-${tab}`).getAttribute("aria-expanded");

    // nothing expanded before the first appState commit
    expect(expanded("layers")).toBe("false");

    await emit({ name: DEFAULT_SIDEBAR.name, tab: "layers" });
    expect(expanded("layers")).toBe("true");
    expect(expanded("comments")).toBe("false");

    // a different sidebar *name* clears the highlight even if the tab matches
    await emit({ name: "layers" } as unknown as AppState["openSidebar"]);
    expect(expanded("layers")).toBe("false");

    // CHARACTERIZATION: the DefaultSidebar can be open with no tab at all
    // (`toggleSidebar({ name })`), and then no collar trigger is highlighted
    // even though the sidebar is visibly open and occupying the surface.
    await emit({ name: DEFAULT_SIDEBAR.name });
    for (const tab of ["layers", "comments", "library"]) {
      expect(expanded(tab)).toBe("false");
    }
  });

  it("is blind to tabs registered through the API", async () => {
    const { api, registerSidebarTab } = makeFakeAPI();
    const { container } = render(<CollarSheetTabs excalidrawAPI={api} />);

    act(() => {
      api.registerSidebarTab({
        name: "sheet",
        label: "Sheet",
        content: <div />,
      });
    });
    expect(registerSidebarTab).toHaveBeenCalledTimes(1);

    // CHARACTERIZATION: registration is invisible to the collar rail — it
    // subscribes to `onChange` (appState) only, and `useProjectSidebarTabs`
    // is not reachable from outside the editor's React tree. This is the
    // drift the redesign deletes.
    await waitFor(() => {
      expect(railLabels(container)).toEqual(["Layers", "Comments", "Library"]);
    });
    expect(screen.queryByTestId("collar-tab-sheet")).toBe(null);
  });
});

describe("CollarSheetTabs — keyboard + ARIA (characterization)", () => {
  it("uses aria-expanded on plain buttons, with no tab roles at all", () => {
    const { api } = makeFakeAPI();
    const { container } = render(<CollarSheetTabs excalidrawAPI={api} />);

    // CHARACTERIZATION: the real sidebar trigger row is a Radix tablist
    // (role=tablist / role=tab / aria-selected — see the fork-side suite). The
    // collar rail is three disconnected `<button aria-expanded>`, so a screen
    // reader announces "collapsed button", never "tab 1 of 3, selected", and
    // nothing links a trigger to the panel it opens.
    // Expected: one accessibility model per control — the rail should BE the
    // sidebar's tablist rather than a parallel widget with a different one.
    expect(container.querySelector("[role=tablist]")).toBe(null);
    expect(container.querySelector("[role=tab]")).toBe(null);

    const buttons = Array.from(
      container.querySelectorAll<HTMLElement>("[data-testid^=collar-tab-]"),
    );
    expect(buttons).toHaveLength(3);
    for (const btn of buttons) {
      expect(btn.tagName).toBe("BUTTON");
      expect(btn.getAttribute("type")).toBe("button");
      expect(btn.hasAttribute("aria-expanded")).toBe(true);
      expect(btn.hasAttribute("aria-selected")).toBe(false);
      expect(btn.hasAttribute("aria-controls")).toBe(false);
    }
  });

  it("puts all three triggers in the tab order (no roving tabindex) and ignores arrow keys", () => {
    const { api, toggleSidebar } = makeFakeAPI();
    const { container } = render(<CollarSheetTabs excalidrawAPI={api} />);

    const buttons = Array.from(
      container.querySelectorAll<HTMLElement>("[data-testid^=collar-tab-]"),
    );

    // plain buttons → each is natively focusable and in the tab order, unlike
    // the sidebar's Radix tablist where only the *container* is tabbable and
    // every trigger sits at tabindex="-1"
    for (const btn of buttons) {
      expect(btn.hasAttribute("tabindex")).toBe(false);
      act(() => btn.focus());
      expect(document.activeElement).toBe(btn);
    }

    // CHARACTERIZATION: no roving focus, so arrow keys do nothing here while
    // they switch tabs in the sidebar's own trigger row. Two rails onto the
    // same surface, two opposite keyboard models.
    act(() => buttons[0].focus());
    fireEvent.keyDown(buttons[0], { key: "ArrowRight" });
    expect(document.activeElement).toBe(buttons[0]);

    // activation is the native button click path (Enter/Space/click)
    fireEvent.click(buttons[0]);
    expect(toggleSidebar).toHaveBeenCalledWith({
      name: DEFAULT_SIDEBAR.name,
      tab: "layers",
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
 * Mounts the real editor + the real collar rail, registering `tabs` the way
 * `MapEditor.tsx` does: an effect keyed on the API that returns the
 * unregister function.
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
        />
        {api && <Registrar api={api} />}
        <CollarSheetTabs excalidrawAPI={api} />
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

describe("CollarSheetTabs × real DefaultSidebar (unmocked cross-seam)", () => {
  it("a collar trigger opens the registered tab's real body in the real sidebar", async () => {
    const restore = withDesktopDimensions();
    try {
      const { container } = await renderCrossSeam([
        {
          name: "layers",
          label: "Layers",
          content: <div data-testid="real-layers-body">layers</div>,
        },
      ]);

      // sidebar starts closed — no shell, no panel
      expect(container.querySelector(".default-sidebar")).toBe(null);

      fireEvent.click(screen.getByTestId("collar-tab-layers"));

      await waitFor(() => {
        // the real DefaultSidebar mounted, showing the registered body
        expect(container.querySelector(".default-sidebar")).not.toBe(null);
        expect(
          container.querySelector('[data-testid="real-layers-body"]'),
        ).not.toBe(null);
      });

      // both rails agree about which tab is active
      expect(
        screen.getByTestId("collar-tab-layers").getAttribute("aria-expanded"),
      ).toBe("true");
      expect(
        container
          .querySelector('[data-testid="sidebar-tab-trigger-layers"]')!
          .getAttribute("aria-selected"),
      ).toBe("true");

      // clicking the same collar trigger again closes the sidebar (toggle)
      fireEvent.click(screen.getByTestId("collar-tab-layers"));
      await waitFor(() => {
        expect(container.querySelector(".default-sidebar")).toBe(null);
      });
    } finally {
      restore();
    }
  });

  it("a tab registered after mount appears in the sidebar's tablist but NOT in the collar rail", async () => {
    const restore = withDesktopDimensions();
    try {
      const { container, getApi } = await renderCrossSeam([
        {
          name: "layers",
          label: "Layers",
          content: <div data-testid="real-layers-body">layers</div>,
        },
      ]);

      fireEvent.click(screen.getByTestId("collar-tab-layers"));
      await waitFor(() => {
        expect(container.querySelector(".default-sidebar")).not.toBe(null);
      });

      await act(async () => {
        getApi().registerSidebarTab({
          name: "sheet",
          label: "Sheet",
          content: <div data-testid="real-sheet-body">sheet</div>,
        });
      });

      // the fork side picks it up immediately (useSyncExternalStore)
      await waitFor(() => {
        expect(
          container.querySelector('[data-testid="sidebar-tab-trigger-sheet"]'),
        ).not.toBe(null);
      });

      // CHARACTERIZATION: the collar rail does not. Any tab the redesign adds
      // is reachable only through the sidebar's own trigger row — which
      // LayerUI hides in collar mode — or through an explicit
      // `toggleSidebar` call from elsewhere in the app.
      expect(screen.queryByTestId("collar-tab-sheet")).toBe(null);
      expect(railLabels(container)).toEqual(["Layers", "Comments", "Library"]);
    } finally {
      restore();
    }
  });

  it("a collar trigger for an unregistered tab opens the sidebar on an empty tab", async () => {
    const restore = withDesktopDimensions();
    try {
      // nothing registered: the rail still offers Layers/Comments/Library
      const { container } = await renderCrossSeam([]);

      fireEvent.click(screen.getByTestId("collar-tab-layers"));

      await waitFor(() => {
        expect(container.querySelector(".default-sidebar")).not.toBe(null);
      });

      // CHARACTERIZATION: the rail's truth is a source literal, not the tab
      // registry, so a trigger can point at a tab nobody registered. The
      // sidebar opens with `openSidebar.tab === "layers"`, no matching
      // trigger, and no visible panel — an open, blank sidebar.
      // Expected: triggers should not exist for tabs that aren't registered.
      expect(
        container.querySelector('[data-testid="sidebar-tab-trigger-layers"]'),
      ).toBe(null);
      expect(container.querySelector("[role=tabpanel]:not([hidden])")).toBe(
        null,
      );
      expect(
        screen.getByTestId("collar-tab-layers").getAttribute("aria-expanded"),
      ).toBe("true");
    } finally {
      restore();
    }
  });
});
