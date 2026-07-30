import clsx from "clsx";

import {
  CANVAS_SEARCH_TAB,
  DEFAULT_SIDEBAR,
  DEFAULT_SIDEBAR_DOM_ID,
  LIBRARY_SIDEBAR_TAB,
  composeEventHandlers,
} from "@atlasdraw/common";

import type { MarkOptional, Merge } from "@atlasdraw/common/utility-types";

import { useTunnels } from "../context/tunnels";
import { useUIAppState } from "../context/ui-appState";

import "../components/dropdownMenu/DropdownMenu.scss";

import {
  useAppProps,
  useExcalidrawSetAppState,
  useProjectSidebarTabs,
} from "./App";
import { LibraryMenu } from "./LibraryMenu";
import { SearchMenu } from "./SearchMenu";
import { Sidebar } from "./Sidebar/Sidebar";
import { DEFAULT_SIDEBAR_STOCK_TABS } from "./Sidebar/defaultSidebarStockTabs";
import { withInternalFallback } from "./hoc/withInternalFallback";

import type { SidebarProps, SidebarTriggerProps } from "./Sidebar/common";

const DefaultSidebarTrigger = withInternalFallback(
  "DefaultSidebarTrigger",
  (
    props: Omit<SidebarTriggerProps, "name"> &
      React.HTMLAttributes<HTMLDivElement>,
  ) => {
    const { DefaultSidebarTriggerTunnel } = useTunnels();
    return (
      <DefaultSidebarTriggerTunnel.In>
        <Sidebar.Trigger
          {...props}
          className="default-sidebar-trigger"
          name={DEFAULT_SIDEBAR.name}
        />
      </DefaultSidebarTriggerTunnel.In>
    );
  },
);
DefaultSidebarTrigger.displayName = "DefaultSidebarTrigger";

const DefaultTabTriggers = ({ children }: { children: React.ReactNode }) => {
  const { DefaultSidebarTabTriggersTunnel } = useTunnels();
  return (
    <DefaultSidebarTabTriggersTunnel.In>
      {children}
    </DefaultSidebarTabTriggersTunnel.In>
  );
};
DefaultTabTriggers.displayName = "DefaultTabTriggers";

export const DefaultSidebar = Object.assign(
  withInternalFallback(
    "DefaultSidebar",
    ({
      children,
      className,
      onDock,
      docked,
      ...rest
    }: Merge<
      MarkOptional<Omit<SidebarProps, "name">, "children">,
      {
        /** pass `false` to disable docking */
        onDock?: SidebarProps["onDock"] | false;
      }
    >) => {
      const appState = useUIAppState();
      const setAppState = useExcalidrawSetAppState();
      // Atlasdraw fork — opt-in host escape hatch, same shape as
      // `collarToolbarTarget`/`collarMenuTarget`: when the host renders its own
      // persistent trigger rail we must not render a second one. Unset ⇒ stock
      // behaviour, so vendored tests and the reference app are unaffected.
      const { hideDefaultSidebarTabTriggers } = useAppProps();

      const { DefaultSidebarTabTriggersTunnel } = useTunnels();

      // Atlasdraw fork — host-app-registered tabs spliced into the
      // DefaultSidebar shell so the project doesn't have to mount a
      // parallel <Sidebar> that competes for the same screen surface.
      // `useProjectSidebarTabs` is `useSyncExternalStore`-backed; the
      // array reference changes on every register/unregister so React
      // re-renders this component when atlas-side wiring evolves.
      const projectTabs = useProjectSidebarTabs();

      const isForceDocked = appState.openSidebar?.tab === CANVAS_SEARCH_TAB;

      // Atlasdraw fork — `Sidebar.Tab` is `RadixTabs.Content`, which always
      // emits `aria-labelledby` pointing at its trigger's generated id. With
      // the trigger row suppressed that id resolves to nothing, so the panel
      // ends up with *no* accessible name at all. Name the panel from the
      // tab's own label instead, and drop the dangling reference (a stale
      // IDREF wins over `aria-label` in some AT implementations).
      //
      // NB: host-supplied `Sidebar.Tab` children (the `{children}` slot below)
      // are outside our reach — a host that suppresses the trigger row owns
      // labelling its own panels.
      const panelLabel = (label: string) =>
        hideDefaultSidebarTabTriggers
          ? { "aria-label": label, "aria-labelledby": undefined }
          : {};

      const stockLabel = (name: string) =>
        DEFAULT_SIDEBAR_STOCK_TABS.find(
          (tab) => tab.name === name,
        )?.getLabel() ?? name;

      return (
        <Sidebar
          {...rest}
          name="default"
          key="default"
          // Stable `aria-controls` target for host-app trigger rails living
          // outside this React tree.
          id={DEFAULT_SIDEBAR_DOM_ID}
          className={clsx("default-sidebar", className)}
          docked={
            isForceDocked || (docked ?? appState.defaultSidebarDockedPreference)
          }
          onDock={
            // `onDock=false` disables docking.
            // if `docked` passed, but no onDock passed, disable manual docking.
            isForceDocked || onDock === false || (!onDock && docked != null)
              ? undefined
              : // compose to allow the host app to listen on default behavior
                composeEventHandlers(onDock, (docked) => {
                  setAppState({ defaultSidebarDockedPreference: docked });
                })
          }
        >
          <Sidebar.Tabs>
            <Sidebar.Header>
              {!hideDefaultSidebarTabTriggers && (
                <Sidebar.TabTriggers>
                  {/* Stock triggers are generated from the same constant
                    `App.getSidebarTabs()` reports to host rails — see
                    `defaultSidebarStockTabs.tsx`. Do not inline a stock
                    trigger here; add it there. */}
                  {DEFAULT_SIDEBAR_STOCK_TABS.map((tab) => (
                    <Sidebar.TabTrigger
                      key={tab.name}
                      tab={tab.name}
                      data-testid={`sidebar-tab-trigger-${tab.name}`}
                    >
                      {tab.icon}
                    </Sidebar.TabTrigger>
                  ))}
                  {projectTabs.map((tab) => (
                    <Sidebar.TabTrigger
                      key={tab.name}
                      tab={tab.name}
                      data-testid={`sidebar-tab-trigger-${tab.name}`}
                    >
                      {tab.icon}
                      {tab.label}
                    </Sidebar.TabTrigger>
                  ))}
                  <DefaultSidebarTabTriggersTunnel.Out />
                </Sidebar.TabTriggers>
              )}
            </Sidebar.Header>
            <Sidebar.Tab
              tab={LIBRARY_SIDEBAR_TAB}
              {...panelLabel(stockLabel(LIBRARY_SIDEBAR_TAB))}
            >
              <LibraryMenu />
            </Sidebar.Tab>
            <Sidebar.Tab
              tab={CANVAS_SEARCH_TAB}
              {...panelLabel(stockLabel(CANVAS_SEARCH_TAB))}
            >
              <SearchMenu />
            </Sidebar.Tab>
            {projectTabs.map((tab) => (
              <Sidebar.Tab
                key={tab.name}
                tab={tab.name}
                data-testid={`sidebar-tab-${tab.name}`}
                {...panelLabel(tab.label)}
              >
                {tab.content}
              </Sidebar.Tab>
            ))}
            {children}
          </Sidebar.Tabs>
        </Sidebar>
      );
    },
  ),
  {
    Trigger: DefaultSidebarTrigger,
    TabTriggers: DefaultTabTriggers,
  },
);
