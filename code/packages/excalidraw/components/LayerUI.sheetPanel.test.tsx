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
