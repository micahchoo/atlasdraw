// SPDX-License-Identifier: AGPL-3.0-only
//
// CHARACTERIZATION SUITE — `registerSidebarTab` → `useProjectSidebarTabs` →
// `DefaultSidebar` seam.
//
// Written as a safety net before the right-sidebar redesign. Nothing else in
// the repo exercises this path end-to-end: `DefaultSidebar.test.tsx` only
// covers docking, `Sidebar/Sidebar.test.tsx` hand-writes `<Sidebar.Tab>`
// children instead of going through `excalidrawAPI.registerSidebarTab`, and
// the atlas-app MapEditor tests stub the whole editor away.
//
// These tests pin CURRENT behaviour, including behaviour that looks wrong.
// Anything questionable is flagged with a `// CHARACTERIZATION:` comment
// stating what would be expected instead. Do not "fix" a test here without
// deciding, deliberately, that the product behaviour is changing.
//
// Conventions match the sibling sidebar tests: `render` from
// `../tests/test-utils`, `withExcalidrawDimensions({1920,1080})` so the
// editor is in desktop form factor (the sidebar renders as an overlay/dock
// rather than the mobile sheet), and `act()`-wrapped `toggleSidebar`.

import React, { useEffect, useState } from "react";

import { CANVAS_SEARCH_TAB, DEFAULT_SIDEBAR } from "@atlasdraw/common";

import { Excalidraw } from "../index";
import {
  act,
  fireEvent,
  render,
  waitFor,
  withExcalidrawDimensions,
} from "../tests/test-utils";

import type { ExcalidrawImperativeAPI, ProjectSidebarTab } from "../types";

const { h } = window;

const toggleSidebar = (
  ...args: Parameters<typeof window.h.app.toggleSidebar>
): Promise<boolean> => {
  return act(() => {
    return window.h.app.toggleSidebar(...args);
  });
};

/**
 * Renders a real, unmocked `<Excalidraw>` (which supplies the fallback
 * `DefaultSidebar`) and registers `tabs` through the public imperative API,
 * exactly the way `MapEditor.tsx` does — an effect keyed on the API that
 * returns the unregister function.
 *
 * `unmountTabs()` unmounts only the registering component, leaving the editor
 * mounted, so cleanup behaviour is observable.
 */
const renderWithProjectTabs = async (
  tabs: readonly ProjectSidebarTab[],
  opts: { openSidebar?: { name: string; tab?: string } | null } = {},
) => {
  let apiRef: ExcalidrawImperativeAPI | null = null;
  let setRegistrarMounted: ((mounted: boolean) => void) | null = null;

  const TabRegistrar = ({ api }: { api: ExcalidrawImperativeAPI }) => {
    useEffect(() => {
      const unregisters = tabs.map((tab) => api.registerSidebarTab(tab));
      return () => unregisters.forEach((unregister) => unregister());
    }, [api]);
    return null;
  };

  const Harness = () => {
    const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
    const [mounted, setMounted] = useState(true);
    setRegistrarMounted = setMounted;
    return (
      <>
        <Excalidraw
          // same wiring as `MapEditor.tsx:818`
          onExcalidrawAPI={(nextApi) => {
            apiRef = nextApi;
            setApi(nextApi);
          }}
          initialData={{
            appState: {
              openSidebar:
                opts.openSidebar === undefined
                  ? { name: DEFAULT_SIDEBAR.name, tab: tabs[0]?.name }
                  : opts.openSidebar,
            },
          }}
        />
        {api && mounted && <TabRegistrar api={api} />}
      </>
    );
  };

  const renderResult = await render(<Harness />);

  // `onExcalidrawAPI` fires before the editor is mounted, so the registration
  // effect lands a commit later than the sidebar shell. Flush it before any
  // assertion. (Can't wait on the trigger DOM here: when the sidebar starts
  // closed, `DefaultSidebar` isn't mounted at all and no trigger exists.)
  await waitFor(() => {
    expect(apiRef).not.toBe(null);
  });
  await act(async () => {});

  return {
    ...renderResult,
    getApi: () => apiRef!,
    unmountTabs: async () => {
      await act(async () => {
        setRegistrarMounted!(false);
      });
    },
  };
};

/**
 * Radix `Tabs.Trigger` activates on **mousedown**, not on `click`, and RTL's
 * `fireEvent.click` does not synthesize a preceding mousedown — so a bare
 * `fireEvent.click` on a sidebar tab trigger does nothing. Real users always
 * produce mousedown first; this helper models that.
 */
const selectTrigger = (trigger: HTMLElement) => {
  fireEvent.mouseDown(trigger, { button: 0, ctrlKey: false });
};

/** Ordered `tab` values of every trigger in the sidebar's Radix tablist. */
const triggerTabValues = (container: HTMLElement): string[] =>
  Array.from(
    container.querySelectorAll<HTMLElement>("[role=tablist] [role=tab]"),
  ).map(
    (el) =>
      // Radix mirrors the `value` onto the generated `id`/`aria-controls`;
      // the stable handle is the accessible name for stock icon-only tabs and
      // the `data-testid` for project tabs, so read the raw Radix state
      // instead: `aria-controls` ends with the tab value.
      el.getAttribute("aria-controls")?.replace(/^.*-content-/, "") ?? "",
  );

const layersTab: ProjectSidebarTab = {
  name: "layers",
  label: "Layers",
  icon: <span data-testid="layers-icon" />,
  content: <div data-testid="layers-body">layers body</div>,
};

const commentsTab: ProjectSidebarTab = {
  name: "comments",
  label: "Comments",
  content: <div data-testid="comments-body">comments body</div>,
};

describe("DefaultSidebar × registerSidebarTab (characterization)", () => {
  describe("1. a registered tab renders its trigger and its body", () => {
    it("renders the trigger in the tab list and the body when selected", async () => {
      const { container } = await renderWithProjectTabs([layersTab]);

      await withExcalidrawDimensions(
        { width: 1920, height: 1080 },
        async () => {
          const trigger = container.querySelector<HTMLElement>(
            '[data-testid="sidebar-tab-trigger-layers"]',
          );
          expect(trigger).not.toBe(null);
          // the trigger really is a Radix tab inside the sidebar's tablist
          expect(trigger).toHaveAttribute("role", "tab");
          expect(trigger!.closest("[role=tablist]")).not.toBe(null);
          // label + icon are both rendered inside the trigger button
          expect(trigger!.textContent).toContain("Layers");
          expect(
            trigger!.querySelector('[data-testid="layers-icon"]'),
          ).not.toBe(null);

          // body is mounted because `openSidebar.tab === "layers"`
          const panel = container.querySelector<HTMLElement>(
            '[role=tabpanel][data-testid="layers"]',
          );
          expect(panel).not.toBe(null);
          expect(panel!.querySelector('[data-testid="layers-body"]')).not.toBe(
            null,
          );

          // CHARACTERIZATION: `DefaultSidebar` passes
          // `data-testid={`sidebar-tab-${name}`}` to `<Sidebar.Tab>`, but
          // `SidebarTab` spreads `...rest` BEFORE its own
          // `data-testid={tab}` — so the panel's testid is the bare tab name
          // ("layers"), and the intended "sidebar-tab-layers" never lands.
          // Expected: the explicit prop should win, or `SidebarTab` should
          // not silently override caller-supplied testids.
          expect(
            container.querySelector('[data-testid="sidebar-tab-layers"]'),
          ).toBe(null);
        },
      );
    });

    it("keeps every panel wrapper in the DOM but mounts only the selected tab's children", async () => {
      const { container } = await renderWithProjectTabs(
        [layersTab, commentsTab],
        { openSidebar: { name: DEFAULT_SIDEBAR.name, tab: "layers" } },
      );

      await withExcalidrawDimensions(
        { width: 1920, height: 1080 },
        async () => {
          // all four panel wrappers exist (search, library, layers, comments)
          expect(container.querySelectorAll("[role=tabpanel]")).toHaveLength(4);
          // ...but the inactive ones are `hidden` and empty
          const commentsPanel = container.querySelector<HTMLElement>(
            '[role=tabpanel][data-testid="comments"]',
          )!;
          expect(commentsPanel).toHaveAttribute("hidden");
          expect(commentsPanel.innerHTML).toBe("");

          expect(
            container.querySelector('[data-testid="layers-body"]'),
          ).not.toBe(null);
          expect(container.querySelector('[data-testid="comments-body"]')).toBe(
            null,
          );

          // selecting the other trigger swaps which children are mounted
          selectTrigger(
            container.querySelector<HTMLElement>(
              '[data-testid="sidebar-tab-trigger-comments"]',
            )!,
          );

          await waitFor(() => {
            expect(
              container.querySelector('[data-testid="comments-body"]'),
            ).not.toBe(null);
            expect(container.querySelector('[data-testid="layers-body"]')).toBe(
              null,
            );
            // selecting a trigger writes through to appState
            expect(h.state.openSidebar).toEqual({
              name: DEFAULT_SIDEBAR.name,
              tab: "comments",
            });
          });
        },
      );
    });
  });

  describe("2. trigger order, and whether stock tabs can be hidden/reordered", () => {
    it("appends project tabs after the stock search + library triggers, in registration order", async () => {
      const { container } = await renderWithProjectTabs([
        layersTab,
        commentsTab,
      ]);

      await withExcalidrawDimensions(
        { width: 1920, height: 1080 },
        async () => {
          expect(triggerTabValues(container)).toEqual([
            CANVAS_SEARCH_TAB,
            "library",
            "layers",
            "comments",
          ]);

          // CHARACTERIZATION: the *panel* order does not match the *trigger*
          // order — `DefaultSidebar` renders `<Sidebar.Tab library>` before
          // `<Sidebar.Tab search>` while the triggers are search-then-library.
          // Harmless while Radix keeps only one panel visible, but it means
          // DOM order is not a usable proxy for tab order.
          expect(
            Array.from(
              container.querySelectorAll<HTMLElement>("[role=tabpanel]"),
            ).map((el) => el.getAttribute("data-testid")),
          ).toEqual(["library", CANVAS_SEARCH_TAB, "layers", "comments"]);
        },
      );
    });

    it("reverses trigger order when registration order reverses", async () => {
      const { container } = await renderWithProjectTabs([
        commentsTab,
        layersTab,
      ]);

      await withExcalidrawDimensions(
        { width: 1920, height: 1080 },
        async () => {
          expect(triggerTabValues(container)).toEqual([
            CANVAS_SEARCH_TAB,
            "library",
            "comments",
            "layers",
          ]);
        },
      );
    });

    it("cannot hide or reorder the stock search/library tabs, and a same-named registration duplicates rather than replaces", async () => {
      // Registering a tab named "library" is the only lever a host app has to
      // aim at a stock tab. It does not replace it.
      const { container } = await renderWithProjectTabs([
        {
          name: "library",
          label: "My Library",
          content: <div data-testid="hijacked-library">hijacked</div>,
        },
      ]);

      await withExcalidrawDimensions(
        { width: 1920, height: 1080 },
        async () => {
          // CHARACTERIZATION: search + library are hardcoded first in
          // `DefaultSidebar` with no `hidden`/`order` prop, so there is no
          // supported way to hide or reorder them. Registering "library"
          // yields TWO triggers and TWO panels with the same Radix value —
          // invalid ARIA (duplicate `aria-controls` targets) and a coin-flip
          // over which panel content the user sees.
          // Expected: either dedupe against stock tab names (throw/warn), or
          // let the host app declare the full tab order.
          expect(triggerTabValues(container)).toEqual([
            CANVAS_SEARCH_TAB,
            "library",
            "library",
          ]);
          // both the stock LibraryMenu panel and the project panel exist
          expect(
            container.querySelectorAll('[role=tabpanel][data-testid="library"]')
              .length,
          ).toBe(2);
          expect(
            container.querySelector('[data-testid="hijacked-library"]'),
          ).not.toBe(null);
        },
      );
    });
  });

  describe("3. which tab is open by default", () => {
    it("opens `library` when the sidebar trigger button is used, and the tab is not configurable", async () => {
      const { container } = await renderWithProjectTabs([layersTab], {
        openSidebar: null,
      });

      await withExcalidrawDimensions(
        { width: 1920, height: 1080 },
        async () => {
          // closed to begin with
          expect(h.state.openSidebar).toBe(null);

          // the only affordance for opening the sidebar is LayerUI's fallback
          // `<DefaultSidebar.Trigger>` — a checkbox whose accessible name is
          // hardcoded to "Library" (`t("toolBar.library")`), even though the
          // sidebar now hosts Search + project tabs too.
          const trigger = container.querySelector<HTMLInputElement>(
            'input[type=checkbox][aria-label="Library"]',
          );
          expect(trigger).not.toBe(null);
          expect(
            trigger!.parentElement!.querySelector(".default-sidebar-trigger"),
          ).not.toBe(null);

          fireEvent.click(trigger!);

          await waitFor(() => {
            // CHARACTERIZATION: `LayerUI` hardcodes
            // `tab={DEFAULT_SIDEBAR.defaultTab}` (= "library") on the
            // fallback trigger, and `DEFAULT_SIDEBAR` is a frozen constant in
            // `packages/common/src/constants.ts`. There is no prop, appState
            // field or API to make a project tab the default landing tab —
            // a host app that registers "layers" still gets "library" when
            // the user clicks the sidebar button.
            // Expected: the default tab should be host-configurable (e.g. an
            // `<Excalidraw defaultSidebarTab>` prop or a registration flag).
            expect(h.state.openSidebar).toEqual({
              name: DEFAULT_SIDEBAR.name,
              tab: "library",
            });
          });
          expect(container.querySelector('[data-testid="layers-body"]')).toBe(
            null,
          );
        },
      );
    });

    it("renders NO tab body when the sidebar is opened without a tab", async () => {
      const { container } = await renderWithProjectTabs([layersTab], {
        openSidebar: { name: DEFAULT_SIDEBAR.name },
      });

      await withExcalidrawDimensions(
        { width: 1920, height: 1080 },
        async () => {
          // the shell + triggers render...
          expect(container.querySelector(".default-sidebar")).not.toBe(null);
          expect(triggerTabValues(container)).toEqual([
            CANVAS_SEARCH_TAB,
            "library",
            "layers",
          ]);
          // CHARACTERIZATION: `SidebarTabs` passes
          // `value={appState.openSidebar.tab}` straight to `RadixTabs.Root`.
          // With `tab === undefined` no tab is selected, so the sidebar opens
          // visibly blank: every panel is `hidden` and every trigger reads
          // `aria-selected="false"`.
          // Expected: fall back to `DEFAULT_SIDEBAR.defaultTab` so the
          // sidebar is never open-but-blank.
          expect(container.querySelector("[role=tabpanel]:not([hidden])")).toBe(
            null,
          );
          expect(
            container.querySelectorAll('[role=tab][aria-selected="true"]'),
          ).toHaveLength(0);
        },
      );
    });
  });

  describe("4. addressing a registered tab from outside", () => {
    it("opens a registered tab via toggleSidebar({ name: DEFAULT_SIDEBAR.name, tab })", async () => {
      const { container } = await renderWithProjectTabs(
        [layersTab, commentsTab],
        { openSidebar: null },
      );

      await withExcalidrawDimensions(
        { width: 1920, height: 1080 },
        async () => {
          expect(
            await toggleSidebar({
              name: DEFAULT_SIDEBAR.name,
              tab: "comments",
            }),
          ).toBe(true);

          await waitFor(() => {
            expect(
              container.querySelector('[data-testid="comments-body"]'),
            ).not.toBe(null);
          });

          // toggling the same {name, tab} again closes the sidebar entirely
          expect(
            await toggleSidebar({
              name: DEFAULT_SIDEBAR.name,
              tab: "comments",
            }),
          ).toBe(false);
          await waitFor(() => {
            expect(container.querySelector(".default-sidebar")).toBe(null);
          });
        },
      );
    });

    it("treats toggleSidebar({ name: 'layers' }) as a no-op surface — nothing renders", async () => {
      const { container } = await renderWithProjectTabs([layersTab], {
        openSidebar: null,
      });

      await withExcalidrawDimensions(
        { width: 1920, height: 1080 },
        async () => {
          // returns `true` ("a sidebar was opened") ...
          expect(await toggleSidebar({ name: "layers" })).toBe(true);
          expect(h.state.openSidebar).toEqual({ name: "layers" });

          // ... but no sidebar named "layers" is mounted anywhere, and the
          // DefaultSidebar is closed, so the user sees nothing at all.
          // CHARACTERIZATION: this is the documented gotcha in
          // `AssetLibraryPanel.tsx`'s header — a registered tab is addressable
          // only as a *tab* of DEFAULT_SIDEBAR, never as a sidebar `name`.
          // The API silently accepts the wrong shape and reports success.
          // Expected: `toggleSidebar` should reject / warn on an unknown
          // sidebar name rather than committing dead appState.
          await waitFor(() => {
            expect(container.querySelector(".sidebar")).toBe(null);
          });
          expect(container.querySelector('[data-testid="layers-body"]')).toBe(
            null,
          );
        },
      );
    });
  });

  describe("5. unregister on unmount", () => {
    it("removes the trigger and the body when the registering component unmounts", async () => {
      const { container, unmountTabs } = await renderWithProjectTabs(
        [layersTab, commentsTab],
        { openSidebar: { name: DEFAULT_SIDEBAR.name, tab: "layers" } },
      );

      await withExcalidrawDimensions(
        { width: 1920, height: 1080 },
        async () => {
          expect(
            container.querySelector('[data-testid="layers-body"]'),
          ).not.toBe(null);

          await unmountTabs();

          await waitFor(() => {
            expect(triggerTabValues(container)).toEqual([
              CANVAS_SEARCH_TAB,
              "library",
            ]);
          });
          expect(container.querySelector('[data-testid="layers-body"]')).toBe(
            null,
          );

          // CHARACTERIZATION: unregistering does NOT reset
          // `appState.openSidebar.tab`, so the sidebar stays open pointing at
          // a tab that no longer exists — an open, empty sidebar with no
          // selected trigger.
          // Expected: unregistering the active tab should fall back to the
          // default tab (or close the sidebar).
          expect(h.state.openSidebar).toEqual({
            name: DEFAULT_SIDEBAR.name,
            tab: "layers",
          });
          expect(container.querySelector(".default-sidebar")).not.toBe(null);
          expect(container.querySelector("[role=tabpanel]:not([hidden])")).toBe(
            null,
          );
        },
      );
    });

    it("re-registering the same name replaces in place, and the stale unregister fn is inert", async () => {
      const { container, getApi } = await renderWithProjectTabs([layersTab]);

      await withExcalidrawDimensions(
        { width: 1920, height: 1080 },
        async () => {
          let staleUnregister: () => void = () => {};
          await act(async () => {
            staleUnregister = getApi().registerSidebarTab({
              ...layersTab,
              label: "Layers v2",
              content: <div data-testid="layers-body-v2">v2</div>,
            });
          });

          await waitFor(() => {
            // deduped by name — still exactly one "layers" trigger, in place
            expect(triggerTabValues(container)).toEqual([
              CANVAS_SEARCH_TAB,
              "library",
              "layers",
            ]);
            expect(
              container.querySelector<HTMLElement>(
                '[data-testid="sidebar-tab-trigger-layers"]',
              )!.textContent,
            ).toContain("Layers v2");
            expect(
              container.querySelector('[data-testid="layers-body-v2"]'),
            ).not.toBe(null);
          });

          // the unregister fn removes by object identity, so calling it twice
          // (or calling a superseded one) is safe rather than removing the
          // wrong entry
          await act(async () => {
            staleUnregister();
            staleUnregister();
          });

          await waitFor(() => {
            expect(triggerTabValues(container)).toEqual([
              CANVAS_SEARCH_TAB,
              "library",
            ]);
          });
        },
      );
    });
  });

  describe("7. keyboard + ARIA reality of the trigger row", () => {
    it("exposes a real tablist/tab/tabpanel triple, with the tablist (not the active tab) in the tab order", async () => {
      const { container } = await renderWithProjectTabs(
        [layersTab, commentsTab],
        { openSidebar: { name: DEFAULT_SIDEBAR.name, tab: "layers" } },
      );

      await withExcalidrawDimensions(
        { width: 1920, height: 1080 },
        async () => {
          const tablist =
            container.querySelector<HTMLElement>("[role=tablist]")!;
          expect(tablist).not.toBe(null);
          expect(tablist).toHaveClass("sidebar-triggers");

          const tabs = Array.from(
            tablist.querySelectorAll<HTMLElement>("[role=tab]"),
          );
          expect(tabs).toHaveLength(4);
          expect(tablist).toHaveAttribute("aria-orientation", "horizontal");

          const active = container.querySelector<HTMLElement>(
            '[data-testid="sidebar-tab-trigger-layers"]',
          )!;
          expect(active).toHaveAttribute("aria-selected", "true");

          // CHARACTERIZATION: the trigger row IS keyboard-reachable, but not
          // in the usual roving-tabindex shape. Until focus has entered the
          // group, Radix's RovingFocusGroup parks `tabindex="0"` on the
          // *tablist* and leaves every trigger at `tabindex="-1"` — including
          // the selected one. So Tab lands on the tablist container (which is
          // styled `outline: none`, i.e. no visible focus ring) and only then
          // do arrow keys reach the triggers.
          // Expected: `tabindex="0"` on the selected trigger, and a visible
          // focus indicator.
          expect(tablist).toHaveAttribute("tabindex", "0");
          expect(
            tabs.filter((t) => t.getAttribute("tabindex") === "0"),
          ).toHaveLength(0);
          expect(active).toHaveAttribute("tabindex", "-1");

          // the selected trigger owns the visible panel
          const panel = container.querySelector<HTMLElement>(
            "[role=tabpanel]:not([hidden])",
          )!;
          expect(active.getAttribute("aria-controls")).toBe(panel.id);
          expect(panel.getAttribute("aria-labelledby")).toBe(active.id);

          // CHARACTERIZATION: the tablist has no accessible name
          // (`RadixTabs.List` gets only a className), so a screen reader
          // announces an unlabelled tablist.
          // Expected: `aria-label` on the trigger row.
          expect(tablist).not.toHaveAttribute("aria-label");
          expect(tablist).not.toHaveAttribute("aria-labelledby");
        },
      );
    });

    it("moves selection with ArrowRight/ArrowLeft (automatic activation)", async () => {
      const { container } = await renderWithProjectTabs(
        [layersTab, commentsTab],
        { openSidebar: { name: DEFAULT_SIDEBAR.name, tab: "layers" } },
      );

      await withExcalidrawDimensions(
        { width: 1920, height: 1080 },
        async () => {
          const active = container.querySelector<HTMLElement>(
            '[data-testid="sidebar-tab-trigger-layers"]',
          )!;
          act(() => active.focus());
          expect(document.activeElement).toBe(active);

          fireEvent.keyDown(active, { key: "ArrowRight" });

          await waitFor(() => {
            // arrow key both moves focus and activates — appState follows
            expect(h.state.openSidebar).toEqual({
              name: DEFAULT_SIDEBAR.name,
              tab: "comments",
            });
            expect(
              container.querySelector('[data-testid="comments-body"]'),
            ).not.toBe(null);
          });

          fireEvent.keyDown(
            container.querySelector<HTMLElement>(
              '[data-testid="sidebar-tab-trigger-comments"]',
            )!,
            { key: "ArrowLeft" },
          );

          await waitFor(() => {
            expect(h.state.openSidebar).toEqual({
              name: DEFAULT_SIDEBAR.name,
              tab: "layers",
            });
          });
        },
      );
    });
  });
});
