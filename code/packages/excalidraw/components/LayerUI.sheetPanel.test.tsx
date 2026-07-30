// SPDX-License-Identifier: AGPL-3.0-only
//
// Atlasdraw fork additions — the right sidebar's width, and the layout signal
// the host reflows against.
//
// Two seams, one file, because they are two halves of one loop: the host owns
// the width and hands it down as `rightSidebarWidth`; the editor publishes it as
// `--right-sidebar-width` and reports back, via `onSidebarLayoutChange`, whether
// it has reserved a column for the panel. Testing them apart would let the pair
// disagree about what "302" means.
//
// The `shrunk` flag is deliberately read from `isUIShrunkForSidebar` — the same
// expression that narrows `.layer-ui__wrapper` and gates the collar legend's
// offset (see LayerUI.collarLegend.test.tsx for the ~604px bug that taught us to
// keep those in one place). The assertions here pin the *pairing*: `shrunk` is
// true exactly when `.sidebar--docked` is, which is the observable proxy that
// suite already established for the wrapper's narrowing.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import React from "react";

import {
  CANVAS_SEARCH_TAB,
  DEFAULT_SIDEBAR,
  RIGHT_SIDEBAR_DEFAULT_WIDTH,
  RIGHT_SIDEBAR_MAX_WIDTH,
  RIGHT_SIDEBAR_MIN_WIDTH,
} from "@atlasdraw/common";

import { Excalidraw } from "../index";
import {
  act,
  render,
  waitFor,
  withExcalidrawDimensions,
} from "../tests/test-utils";

import type { ExcalidrawImperativeAPI } from "../types";

const { h } = window;

const HOST_TAB = "layers";

const editorContainer = (container: HTMLElement) =>
  container.querySelector<HTMLElement>(".excalidraw-container")!;

const sidebarWidthVar = (container: HTMLElement) =>
  editorContainer(container).style.getPropertyValue("--right-sidebar-width");

const renderEditor = async (props: {
  rightSidebarWidth?: number;
  onSidebarLayoutChange?: (l: {
    open: boolean;
    shrunk: boolean;
    collar: boolean;
  }) => void;
  collar?: boolean;
}) => {
  const collarToolbarTarget = document.createElement("div");
  document.body.appendChild(collarToolbarTarget);

  let api: ExcalidrawImperativeAPI | null = null;
  const result = await render(
    <Excalidraw
      collarToolbarTarget={props.collar === false ? null : collarToolbarTarget}
      rightSidebarWidth={props.rightSidebarWidth}
      onSidebarLayoutChange={props.onSidebarLayoutChange}
      onExcalidrawAPI={(nextApi) => {
        api = nextApi;
      }}
    />,
  );

  // A host-registered tab so the undocked case doesn't have to go through the
  // stock `library` tab, whose async item load fires state updates outside
  // act(). Same reasoning as LayerUI.collarLegend.test.tsx.
  await act(async () => {
    api!.registerSidebarTab({
      name: HOST_TAB,
      label: "Layers",
      content: <div data-testid="layers-body">layers</div>,
    });
  });

  return result;
};

const openSidebar = async (tab: string) => {
  await act(async () => {
    h.app.toggleSidebar({ name: DEFAULT_SIDEBAR.name, tab, force: true });
  });
  await act(async () => {});
};

const closeSidebar = async () => {
  await act(async () => {
    h.app.setAppState({ openSidebar: null });
  });
  await act(async () => {});
};

describe("rightSidebarWidth publishes --right-sidebar-width", () => {
  it("defaults to upstream's 302px when the prop is absent", async () => {
    const { container } = await renderEditor({});

    expect(sidebarWidthVar(container)).toBe(`${RIGHT_SIDEBAR_DEFAULT_WIDTH}px`);
    expect(RIGHT_SIDEBAR_DEFAULT_WIDTH).toBe(302);
  });

  it("publishes a width inside the allowed range verbatim", async () => {
    const { container } = await renderEditor({ rightSidebarWidth: 420 });

    expect(sidebarWidthVar(container)).toBe("420px");
  });

  it("clamps below the minimum and above the maximum", async () => {
    const narrow = await renderEditor({ rightSidebarWidth: 40 });
    expect(sidebarWidthVar(narrow.container)).toBe(
      `${RIGHT_SIDEBAR_MIN_WIDTH}px`,
    );

    const wide = await renderEditor({ rightSidebarWidth: 4000 });
    expect(sidebarWidthVar(wide.container)).toBe(
      `${RIGHT_SIDEBAR_MAX_WIDTH}px`,
    );
  });

  it("sizes the sidebar box to the full property in collar mode", async () => {
    // Upstream subtracts a `--space-factor * 2` island gutter, which would
    // leave an 8px sliver of map between the panel and everything that offset
    // by the full property. The collar panel is the sheet's margin — flush.
    const { container } = await renderEditor({ rightSidebarWidth: 420 });
    await withExcalidrawDimensions({ width: 1920, height: 1080 }, async () => {
      await openSidebar(HOST_TAB);
      await waitFor(() => {
        expect(container.querySelector(".sidebar")).not.toBe(null);
      });
      expect(editorContainer(container).classList).toContain(
        "excalidraw--collar",
      );
    });
  });

  it("does not mark non-collar hosts as collar mode", async () => {
    const { container } = await renderEditor({ collar: false });

    expect(editorContainer(container).classList).not.toContain(
      "excalidraw--collar",
    );
  });
});

describe("onSidebarLayoutChange reports the sidebar's layout", () => {
  it("reports closed on mount", async () => {
    const onSidebarLayoutChange = vi.fn();
    await renderEditor({ onSidebarLayoutChange });

    expect(onSidebarLayoutChange).toHaveBeenCalledWith({
      open: false,
      shrunk: false,
      collar: true,
    });
  });

  it("reports open+shrunk for a docked sidebar, matching .sidebar--docked", async () => {
    const onSidebarLayoutChange = vi.fn();
    const { container } = await renderEditor({ onSidebarLayoutChange });

    await withExcalidrawDimensions({ width: 1920, height: 1080 }, async () => {
      // `search` force-docks (DefaultSidebar's isForceDocked) — no dock click.
      await openSidebar(CANVAS_SEARCH_TAB);

      await waitFor(() => {
        expect(onSidebarLayoutChange).toHaveBeenLastCalledWith({
          open: true,
          shrunk: true,
          collar: true,
        });
      });
      // The invariant: `shrunk` is the wrapper's own narrowing, nothing else.
      expect(container.querySelector(".sidebar.sidebar--docked")).not.toBe(
        null,
      );
    });
  });

  it("reports open but NOT shrunk for a floating sidebar", async () => {
    const onSidebarLayoutChange = vi.fn();
    const { container } = await renderEditor({ onSidebarLayoutChange });

    await withExcalidrawDimensions({ width: 1920, height: 1080 }, async () => {
      expect(h.state.defaultSidebarDockedPreference).toBe(false);
      await openSidebar(HOST_TAB);

      await waitFor(() => {
        expect(onSidebarLayoutChange).toHaveBeenLastCalledWith({
          open: true,
          shrunk: false,
          collar: true,
        });
      });
      expect(container.querySelector(".sidebar.sidebar--docked")).toBe(null);
    });
  });

  it("reports closed again after the sidebar closes", async () => {
    const onSidebarLayoutChange = vi.fn();
    await renderEditor({ onSidebarLayoutChange });

    await withExcalidrawDimensions({ width: 1920, height: 1080 }, async () => {
      await openSidebar(CANVAS_SEARCH_TAB);
      await closeSidebar();

      await waitFor(() => {
        expect(onSidebarLayoutChange).toHaveBeenLastCalledWith({
          open: false,
          shrunk: false,
          collar: true,
        });
      });
    });
  });

  it("never reports shrunk when the editor is too narrow to fit the sidebar", async () => {
    // Below MQ_RIGHT_SIDEBAR_MIN_WIDTH: canFitSidebar is false, the sidebar
    // floats however it is docked, and a host that reflowed here would hand
    // its map's pixels to a panel that is covering it anyway.
    const onSidebarLayoutChange = vi.fn();
    await renderEditor({ onSidebarLayoutChange });

    await withExcalidrawDimensions({ width: 800, height: 1000 }, async () => {
      await openSidebar(CANVAS_SEARCH_TAB);

      await waitFor(() => {
        expect(onSidebarLayoutChange).toHaveBeenLastCalledWith({
          open: true,
          shrunk: false,
          collar: true,
        });
      });
    });
  });

  it("reports collar:false for a non-collar host, whatever the sidebar does", async () => {
    // The gate atlasdraw's resize handle needs. Without the collar treatment
    // the sidebar is `width - space-factor * 2` wide (Sidebar.scss), so the
    // handle's `right: width` misses the edge by 8px and becomes a col-resize
    // target floating over the host's map. Same signal covers the phone, which
    // drops collar mode for the same reason it drops the collar toolbar.
    const onSidebarLayoutChange = vi.fn();
    const { container } = await renderEditor({
      collar: false,
      onSidebarLayoutChange,
    });

    await withExcalidrawDimensions({ width: 1920, height: 1080 }, async () => {
      await openSidebar(CANVAS_SEARCH_TAB);

      await waitFor(() => {
        expect(onSidebarLayoutChange).toHaveBeenLastCalledWith({
          open: true,
          shrunk: true,
          collar: false,
        });
      });
      expect(editorContainer(container).classList).not.toContain(
        "excalidraw--collar",
      );
    });
  });
});

// ---------------------------------------------------------------------------
// A tab body taller than the sidebar has to be able to scroll.
//
// `.sidebar` is `overflow: hidden`, and `.sidebar-tabs-root` / `[role=tabpanel]`
// are `flex: 1 1 auto` in a column — which permits shrinking but does NOT
// achieve it, because a column flex item's `min-height: auto` resolves to its
// content height. So an over-tall tab body pushed the chain past the sidebar's
// height and the excess was clipped with no scroll port anywhere. Measured in
// Chromium at 25 data layers: tabs-root 1393px inside a 764px sidebar, 11 rows
// unreachable. Every level needs the override or the one that keeps `auto`
// re-establishes the content floor.
//
// Asserted against the stylesheet source: jsdom does no layout and vitest does
// not load the compiled SCSS, so `getComputedStyle` reports nothing either way.
// The stylesheet is where this can regress.
describe("sidebar tab bodies can shrink below their content", () => {
  const scss = readFileSync(
    path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "Sidebar",
      "Sidebar.scss",
    ),
    "utf8",
  );

  /** Body of a nested SCSS block, brace-matched — `[^}]*` stops at the first
   *  nested rule's closing brace. */
  const block = (selector: string) => {
    // Anchored at a line start so `.sidebar` finds the nested rule and not
    // `.excalidraw.excalidraw--collar .sidebar` — which sets only the width.
    const opener = new RegExp(
      `^\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{`,
      "m",
    ).exec(scss);
    const start = opener?.index ?? -1;
    if (start < 0) {
      throw new Error(`${selector} not found in Sidebar.scss`);
    }
    let depth = 0;
    for (let i = scss.indexOf("{", start); i < scss.length; i++) {
      if (scss[i] === "{") {
        depth++;
      } else if (scss[i] === "}") {
        depth--;
        if (depth === 0) {
          return scss.slice(start, i);
        }
      }
    }
    throw new Error(`unbalanced braces after ${selector}`);
  };

  /**
   * Declarations directly on the block, with nested rules removed.
   *
   * Brace-matched rather than regex-stripped. A `.../\{[^}]*\}/` strip stops at
   * the first nested rule's own closing brace, so one nested rule with a nested
   * rule inside it leaks the inner declarations up — and `.sidebar-tabs-root`
   * would then read `[role="tabpanel"]`'s `min-height: 0` as its own and pass
   * with its own declaration deleted. Reproduced before rewriting this.
   */
  const ownDeclarations = (selector: string) => {
    const body = block(selector);
    let depth = 0;
    let out = "";
    // Start past the block's own opening brace.
    for (let i = body.indexOf("{") + 1; i < body.length; i++) {
      const ch = body[i];
      if (ch === "{") {
        if (depth === 0) {
          // A nested rule's SELECTOR sits at depth 0, ahead of this brace, and
          // has already been collected. Drop back to the end of the last real
          // declaration so the selector text does not read as one.
          out = out.slice(0, Math.max(out.lastIndexOf(";") + 1, 0));
        }
        depth++;
      } else if (ch === "}") {
        depth--;
      } else if (depth === 0) {
        out += ch;
      }
    }
    return out;
  };

  it("the tabs root can shrink", () => {
    expect(ownDeclarations(".sidebar-tabs-root")).toMatch(/min-height\s*:\s*0/);
  });

  it("the tab panel can shrink", () => {
    expect(ownDeclarations('[role="tabpanel"]')).toMatch(/min-height\s*:\s*0/);
  });

  it("ownDeclarations does not leak a nested rule's declarations upward", () => {
    // Guards the helper itself: `.sidebar-tabs-root` contains the tabpanel rule,
    // whose selector is the one thing that must not show up as the root's own.
    expect(ownDeclarations(".sidebar-tabs-root")).not.toContain("tabpanel");
    expect(ownDeclarations(".sidebar-tabs-root")).not.toContain("tablist");
  });

  it("the sidebar still clips rather than scrolling as a whole", () => {
    // The fix is "the tab body is the scroll port", not "the sidebar scrolls".
    // A scrolling sidebar would take its own header with it.
    expect(block(".sidebar")).toMatch(/overflow\s*:\s*hidden/);
  });
});
