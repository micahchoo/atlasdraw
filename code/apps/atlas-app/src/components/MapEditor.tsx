/**
 * MapEditor — visual keystone for Phase 1.
 *
 * Stacks MapLibre GL (bottom) + Excalidraw (top, transparent) in an
 * absolute-positioned container. Both layers fill the container via CSS
 * modules; the Excalidraw layer has pointer-events: none by default so map
 * interactions pass through. Task 13 wires isDrawingMode → .excalidrawLayerActive.
 *
 * API surface for downstream tasks:
 *   map            — from useMapRef(); useCoordinateSync reads this as a reactive dep.
 *   excalidrawAPI  — from onExcalidrawAPI callback; Task 12 reads this too.
 *   onMount        — fires once when BOTH map AND api are non-null; callers
 *                    (e.g. integration tests, Task 12 hook) can use this as
 *                    a "ready" signal.
 *
 * Flow position: Step 1 of Flow A (map.on("move") → CoordinateSync path)
 *                and Flow B (pointer-down → tool dispatch path). This task
 *                builds the DOM stack; tasks 12+13 wire the dynamic behaviour.
 */

import React, {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
  useSyncExternalStore,
} from "react";
import { MapCanvas } from "@atlasdraw/basemap";

import { getBasemap } from "@atlasdraw/basemap";

// @atlasdraw/data imports removed (unused after refactor)
import {
  Excalidraw,
  MainMenu,
  setExportElementTransformer,
} from "@atlasdraw/excalidraw";

import { DEFAULT_SIDEBAR } from "@atlasdraw/common";

import { PinTool } from "@atlasdraw/tools";

import { isGeoCustomData, normalizeElementsForExport } from "@atlasdraw/geo";

import type {
  ExcalidrawElement,
  ExcalidrawImperativeAPI,
} from "@atlasdraw/excalidraw";

import type { GeoAnchor, ScaleMode } from "@atlasdraw/geo";

import type { BasemapConfig } from "@atlasdraw/basemap";

import type { MapCanvasInitialView } from "@atlasdraw/basemap";

import { useMapRef } from "../hooks/useMapRef";
import { useCollabDataLayer } from "../hooks/useCollabDataLayer";
import { useConvertToDataLayer } from "../hooks/useConvertToDataLayer";
import { usePersistenceWiring } from "../hooks/usePersistenceWiring";
import { useMapEditorKeyboard } from "../hooks/useMapEditorKeyboard";
import { useExcalidrawChangeHandler } from "../hooks/useExcalidrawChangeHandler";
import { useCoordinateSync } from "../hooks/useCoordinateSync";
import { useGeoAnchor } from "../hooks/useGeoAnchor";
import { useLayerRegistrySync } from "../hooks/useLayerRegistrySync";
import { useToolState } from "../hooks/useToolState";
import { useAtlasdrawTool } from "../hooks/useAtlasdrawTool";
import { useMapWheelRouter } from "../hooks/useMapWheelRouter";
import { useLayerRegistry } from "../hooks/useLayerRegistry";
import { CollabContext, type CollabContextValue } from "../hooks/useCollab";
import { useCollabRoom } from "../hooks/useCollabRoom";
import { useYjsLayer } from "../hooks/useYjsLayer";
import { useDataFileImport } from "../hooks/useDataFileImport";
import { useExportPNG } from "../hooks/useExportPNG";
import { useBasemapStyle } from "../hooks/useBasemapStyle";
import { CollabState } from "../state/collab";

import { asWorkspaceId, resolveWorkspaceFromEnv } from "../state/workspace";

import { usePersistenceStore } from "../state/usePersistenceStore";
import { useLayerRegistryStore } from "../state/layerRegistry";
import { selectDocument } from "../state/selectDocument";
import { hydrate } from "../state/hydrate";
import { getAppConfig } from "../config/app-config";
import { fitMapToContent } from "../lib/fitMapToContent";
import {
  createHttpStorageClient,
  type HttpStorageClient,
} from "../services/createHttpStorageClient";

import styles from "../styles/MapEditor.module.css";

import { useToast } from "./ToastProvider";

import { CollarShell } from "./CollarShell";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { PrintDialog } from "./PrintDialog";
import { ShareDialog } from "./ShareDialog";
import { AboutDialog } from "./AboutDialog";
import { AssetLibraryPanel } from "./AssetLibraryPanel";
import { MaputnikDialog } from "./MaputnikDialog";
import { BasemapPickerDialog } from "./BasemapPickerDialog";
import { CommentAnchorsOverlay } from "./CommentAnchorsOverlay";
import { CursorOverlay } from "./CursorOverlay";
import { PresenceList } from "./PresenceList";
import { StatusBar } from "./StatusBar";
import { GeoSearchControl } from "./GeoSearchControl";
import { ToolOptionsBar } from "./ToolOptionsBar";
import { KeyboardShortcuts } from "./KeyboardShortcuts";
import { QuickActions } from "./QuickActions";
import { CommentsPanelHost } from "./CommentsPanelHost";
import { LayerPanel } from "./LayerPanel";
import { useAnnounce } from "./AriaAnnouncer";
import { OnboardingTips, useOnboarding } from "./OnboardingTips";
import { SettingsDialog } from "./SettingsDialog";
import { ExportDialog } from "./ExportDialog";

import type { LayerLegendEntry } from "../lib/print-pdf";

import type maplibregl from "maplibre-gl";
import type { Feature, FeatureCollection, Geometry } from "geojson";

// ---------------------------------------------------------------------------
// GeoJSON export helpers
// ---------------------------------------------------------------------------

function geoAnchorToGeometry(anchor: GeoAnchor): Geometry {
  if (anchor.kind === "point") {
    return { type: "Point", coordinates: [anchor.lng, anchor.lat] };
  }
  if (anchor.kind === "bbox") {
    const { west, south, east, north } = anchor;
    return {
      type: "Polygon",
      coordinates: [
        [
          [west, north],
          [east, north],
          [east, south],
          [west, south],
          [west, north],
        ],
      ],
    };
  }
  return { type: "LineString", coordinates: anchor.coordinates };
}

function buildGeoJsonExport(elements: readonly unknown[]): FeatureCollection {
  const features: Feature[] = [];
  for (const el of elements) {
    if (typeof el !== "object" || el === null) {
      continue;
    }
    const cd = (el as { customData?: unknown }).customData;
    if (!isGeoCustomData(cd)) {
      continue;
    }
    features.push({
      type: "Feature",
      geometry: geoAnchorToGeometry(cd.geo),
      properties: {},
    });
  }
  return { type: "FeatureCollection", features };
}

// ---------------------------------------------------------------------------
// Atlas document Save / Open (one format, one door — ADR 0010 cohesion work)
//
// The .atlasdraw bundle is the canonical format and these two handlers are
// the ONLY save/open surfaces: the "Open…" / "Save" MainMenu items and the
// Cmd+O / Cmd+S bindings all route here. Excalidraw's own persistence
// actions (LoadScene, SaveToActiveFile, the JSONExportDialog) are disabled
// via UIOptions.canvasActions — see EXCALIDRAW_UI_OPTIONS below — which
// also disables their built-in keyboard shortcuts (action `predicate`
// gates both, actions/manager.tsx). Rendering/format export (PNG, PDF,
// GeoJSON, .atlasdraw) lives in the atlas ExportDialog ("Export…" item).
//
// Exported for unit tests (MapEditor.atlasdraw-export.test.tsx) — the same
// contract the old renderCustomUI cards carried before 9078's dialog was
// itself replaced by this single door.
// ---------------------------------------------------------------------------

/** User-facing outcome channel for the document handlers (toast in the app;
 * omitted in tests and non-UI callers). */
export interface DocumentNotify {
  success: (msg: string) => void;
  error: (msg: string) => void;
}

/** Picker dismissals are a user choice, not a failure — never report them. */
function isPickerCancel(err: unknown): boolean {
  return (
    err instanceof DOMException &&
    (err.name === "AbortError" || err.name === "NotAllowedError")
  );
}

export async function saveAtlasDocument(
  excalidrawAPI: ExcalidrawImperativeAPI | null,
  notify?: DocumentNotify,
): Promise<void> {
  if (!excalidrawAPI) {
    return;
  }
  const store = usePersistenceStore.getState().persistenceStore;
  if (!store) {
    return;
  }
  try {
    await store.saveToDisk(
      selectDocument(excalidrawAPI, useLayerRegistryStore.getState()),
    );
    usePersistenceStore.getState().clearDirty();
    notify?.success("Map saved as .atlasdraw");
  } catch (err) {
    if (isPickerCancel(err)) {
      return;
    }
    // eslint-disable-next-line no-console
    console.warn("[atlasdraw] saveToDisk failed", err);
    notify?.error(
      `Couldn't save the map${err instanceof Error ? ` — ${err.message}` : ""}`,
    );
  }
}

export async function openAtlasDocument(
  excalidrawAPI: ExcalidrawImperativeAPI | null,
  notify?: DocumentNotify,
): Promise<void> {
  if (!excalidrawAPI) {
    return;
  }
  const store = usePersistenceStore.getState().persistenceStore;
  if (!store) {
    return;
  }
  try {
    const loaded = await store.openFromDisk();
    if (loaded) {
      // Phase 4 W0 (atlasdraw-3601): apply to live runtime —
      // see state/hydrate.ts for ordering + idempotency.
      await hydrate(loaded, excalidrawAPI);
      // eslint-disable-next-line no-console
      console.info("[atlasdraw] document opened + hydrated", {
        id: loaded.manifest.id,
        layerCount: loaded.manifest.layers.length,
        sceneLength: loaded.scene.length,
      });
      const n = loaded.manifest.layers.length;
      notify?.success(
        `Opened "${loaded.manifest.title}" — ${n} layer${n === 1 ? "" : "s"}`,
      );
    }
  } catch (err) {
    if (isPickerCancel(err)) {
      return;
    }
    // eslint-disable-next-line no-console
    console.warn("[atlasdraw] openFromDisk failed", err);
    notify?.error(
      "Couldn't open the file — it doesn't look like a valid .atlasdraw or .excalidraw document",
    );
  }
}

// Module-scoped so the Excalidraw mount sees a stable identity. Excalidraw
// reads initialData once on mount; passing a fresh literal each render is
// harmless today but brittle if a future Excalidraw version memoizes on it.
const EXCALIDRAW_INITIAL_DATA = {
  appState: { viewBackgroundColor: "transparent" },
} as const;

// One format, one door: disable Excalidraw's own persistence actions
// (.excalidraw load/save + the JSONExportDialog). The `predicate` on each
// action gates its keyboard shortcut too, so Cmd+O / Cmd+S fall through to
// the atlas handlers wired in MapEditor's own onKeyDown.
const EXCALIDRAW_UI_OPTIONS = {
  canvasActions: {
    loadScene: false,
    saveToActiveFile: false,
    export: false as const,
  },
} as const;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface MapEditorProps {
  /** Initial map viewport; changes after mount are ignored. */
  initialView?: MapCanvasInitialView;

  /**
   * Called once when both the MapLibre Map instance and the Excalidraw
   * imperative API are available. Stable per (map, api) tuple — won't refire
   * if the parent re-renders with a fresh callback closure.
   */
  onMount?: (map: maplibregl.Map, api: ExcalidrawImperativeAPI) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MapEditor({ initialView, onMount }: MapEditorProps) {
  const { map, onMapReady } = useMapRef();
  const [excalidrawAPI, setExcalidrawAPI] =
    useState<ExcalidrawImperativeAPI | null>(null);
  const toast = useToast();
  // Stable outcome channel for save/open — see DocumentNotify above.
  const documentNotify = useMemo<DocumentNotify>(
    () => ({ success: toast.success, error: toast.error }),
    [toast.success, toast.error],
  );
  // Stores the user-chosen background color, intercepted from Excalidraw's
  // ChangeCanvasBackground picker. Applied as CSS backgroundColor on the root
  // container so it shows behind both layers as a fallback.
  //
  // MapLibre-native alternative (richer, affects WebGL rendering + export):
  //   if (!map.getLayer('atlas-bg'))
  //     map.addLayer({ id: 'atlas-bg', type: 'background',
  //                    paint: { 'background-color': color } }, firstLayerId)
  //   else
  //     map.setPaintProperty('atlas-bg', 'background-color', color)
  // That path ensures the color appears in the live map tile rendering AND in
  // the raw canvas captured by getBackgroundCanvas. CSS on root is sufficient
  // for now because the composite export draws the MapLibre canvas directly —
  // any map-level background layer would already be baked into that canvas.
  const [mapBg, setMapBg] = useState("transparent");
  // Phase 4 T6 — active basemap, replacing the canvas background picker slot.
  const [activeBasemapId, setActiveBasemapId] =
    useState<BasemapConfig["id"]>("protomaps-light");
  const [showBasemapPicker, setShowBasemapPicker] = useState(false);
  // Phase 6 A4 — Maputnik "Edit basemap style" modal.
  const [maputnikOpen, setMaputnikOpen] = useState(false);
  const [showAboutDialog, setShowAboutDialog] = useState(false);
  const [showShareDialog, setShowShareDialog] = useState(false);
  // Phase 6 A10 — PDF export modal.
  const [showPrintDialog, setShowPrintDialog] = useState(false);
  // Phase 6 A12 — Asset library info panel + dialog. Pushes the 3 bundled
  // .excalidrawlib fixtures (wildfire / transit / hazard) into Excalidraw's
  // built-in library via updateLibrary({ libraryItems, merge: true }).
  const [showAssetLibrary, setShowAssetLibrary] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showExport, setShowExport] = useState(false);
  // Phase 6 A13a — active workspace (managed mode only). Seeded from the
  // A9 env resolver so the boot path still works; the WorkspaceSwitcher
  // updates this when the user picks one. Self-host: stays at the env-
  // resolved value (typically null) and the switcher renders nothing.
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(
    () =>
      resolveWorkspaceFromEnv(
        import.meta.env as Record<string, string | undefined>,
      ).id,
  );

  // Phase 5 collab integration (Step 6) — a single CollabState instance owned
  // by MapEditor. The lifecycle is component-scoped: instantiated on mount,
  // disconnected on unmount. Both useCollabRoom (URL → connect) and
  // ShareDialog (manual collab share) call into this same instance so there
  // is only ever one live socket per room.
  //
  // ISSUES.md Issue 9: this used to be the ONLY place the real, connected
  // instance was used — useCollab() (below) built and read its own separate,
  // never-connected fallback CollabState because no CollabContext.Provider
  // was ever mounted. useYjsLayer, CursorOverlay, and PresenceList all read
  // that disconnected fallback, so remote peer/data-layer updates never
  // reached them. Fixed by deriving `collabValue` from THIS instance via
  // useSyncExternalStore (subscribe/getSnapshot — see state/collab.ts) and
  // wrapping the return tree in <CollabContext.Provider value={collabValue}>
  // below, so every useCollab() call in this subtree reads the real session.
  const collabState = useMemo(() => new CollabState(), []);

  const collabSnapshot = useSyncExternalStore(
    collabState.subscribe,
    collabState.getSnapshot,
  );
  const collabValue = useMemo<CollabContextValue>(
    () => ({
      active: collabState.active,
      peers: collabSnapshot.peers,
      localCursor: collabSnapshot.localCursor,
      yjsDoc: collabSnapshot.yjsDoc,
      commentsLayer: collabSnapshot.commentsLayer,
      connect: collabState.connect.bind(collabState),
      disconnect: collabState.disconnect.bind(collabState),
    }),
    [collabState, collabSnapshot],
  );

  // Phase 5 collab integration (Step 5) — fragment → connect bridge.
  // Reads window.location.hash and connects when it's a `#room:` fragment.
  // Surfaces an inline banner if the fragment is malformed.
  const { error: collabRoomError } = useCollabRoom(collabState);

  // Phase 5 collab integration — wire Excalidraw <-> CollabState for Q-P5-1
  // snapshot pull. setSceneAccessor lets THIS client serve REQUEST_SNAPSHOT
  // when the relay elects us; setSceneReceiver applies an inbound
  // SCENE_SNAPSHOT to the local Excalidraw scene.
  useEffect(() => {
    if (!excalidrawAPI) {
      return;
    }
    collabState.setSceneAccessor(
      () => excalidrawAPI.getSceneElements() as ExcalidrawElement[],
    );
    collabState.setSceneReceiver((elements) =>
      excalidrawAPI.updateScene({ elements }),
    );
  }, [collabState, excalidrawAPI]);

  // Unmount cleanup — close the live session if any. Safe when no connection
  // was ever opened (disconnect() is idempotent).
  useEffect(() => {
    return () => {
      collabState.disconnect();
    };
  }, [collabState]);

  // Phase 5 Task 9 — YjsLayer React binding. When collab is active and
  // connected, returns the GeoJSON FeatureCollection snapshot and CRUD
  // mutators from the shared Y.Doc. When inactive, returns nulls.
  // The map re-projection effect below syncs features to the MapLibre source.
  const yjsLayer = useYjsLayer(collabValue);

  // Phase 4 T8 — share-link HTTP client. Lazy: only built when the share
  // dialog opens (avoids hitting fetch in the local-only / pages tiers).
  // Phase 6 A13a: thread `getWorkspaceId` so storage requests carry the
  // X-Workspace-ID header for the currently-selected workspace. We use a
  // ref to the active id so re-renders don't rebuild the client.
  const activeWorkspaceIdRef = useRef<string | null>(activeWorkspaceId);
  useEffect(() => {
    activeWorkspaceIdRef.current = activeWorkspaceId;
  }, [activeWorkspaceId]);
  const shareClientRef = useRef<HttpStorageClient | null>(null);
  function getShareClient(): HttpStorageClient {
    if (!shareClientRef.current) {
      const cfg = getAppConfig();
      shareClientRef.current = createHttpStorageClient({
        baseUrl: cfg.storageBaseUrl ?? "",
        getWorkspaceId: () => activeWorkspaceIdRef.current,
      });
    }
    return shareClientRef.current;
  }
  // Root container ref — used by useMapWheelRouter to intercept wheel events
  // in capture phase before they reach the Excalidraw layer (atlasdraw-5afc).
  const rootRef = useRef<HTMLDivElement>(null);
  // Phase 6 A14b — aria-live selection-change announcer, read inside
  // useExcalidrawChangeHandler.
  const announceMapEditor = useAnnounce();
  // Space+drag pan bridge: when space is held, Excalidraw's internal pan
  // mechanism mutates scrollX/Y. The scroll lock below resets those to 0
  // every onChange (preserving geo-anchor identity). Without this bridge,
  // the delta is eaten and the map never moves. The hand-tool button works
  // because it sets pointer-events:none — events fall through to MapLibre
  // directly. Space+drag takes the scroll-mutation path instead.
  const spaceHeldRef = useRef(false);

  // Fire onMount exactly once per (map, api) tuple. `onMount` is intentionally
  // excluded from deps so a re-rendered parent passing a fresh closure doesn't
  // retrigger the callback.
  useEffect(() => {
    if (map && excalidrawAPI) {
      onMount?.(map, excalidrawAPI);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, excalidrawAPI]); // onMount excluded: fire-once-per-tuple semantics

  // Phase 4 T6/T7 — basemap style application (extracted to useBasemapStyle).
  useBasemapStyle(map, activeBasemapId, getAppConfig().allowRemoteBasemaps);

  // Normalize geo-anchored element coords to canonical Web Mercator (zoom 0)
  // before .excalidraw file saves so saved files are viewport-independent.
  useEffect(() => {
    setExportElementTransformer(
      normalizeElementsForExport as Parameters<
        typeof setExportElementTransformer
      >[0],
    );
    return () => setExportElementTransformer(null);
  }, []);

  // Dev-only window expose for Playwright E2E. Production builds skip this
  // branch via `import.meta.env.DEV` (Vite replaces it with `false` in prod,
  // making the whole block dead code that gets tree-shaken).
  useEffect(() => {
    if (!import.meta.env.DEV) {
      return;
    }
    if (!map || !excalidrawAPI) {
      return;
    }
    const w = window as unknown as { __atlasdraw__?: unknown };
    w.__atlasdraw__ = { map, excalidrawAPI };
    return () => {
      delete (window as unknown as { __atlasdraw__?: unknown }).__atlasdraw__;
    };
  }, [map, excalidrawAPI]);

  // T9 — Persistence wiring (extracted to usePersistenceWiring hook): creates
  // the PersistenceStore, loads + hydrates any previously-persisted document,
  // starts auto-save, and mirrors dirty/drain state into Zustand.
  usePersistenceWiring(excalidrawAPI, documentNotify);

  // Wire camera events → CoordinateSync.syncMapToScene (throttled at 16ms).
  // syncNow lets us trigger an immediate sync outside camera events (e.g. after file load).
  const { syncNow } = useCoordinateSync(map, excalidrawAPI);

  // Route wheel events to the map regardless of whether Excalidraw's drawing
  // layer is on top. Without this, scroll-to-zoom is silently captured by
  // Excalidraw in any non-hand tool and annotations don't re-project.
  useMapWheelRouter(rootRef.current, map);

  // Auto-anchor stock bbox tools (rectangle/ellipse/diamond) on creation.
  useGeoAnchor(map, excalidrawAPI);

  // W-A — wire LayerRegistry to actual rendering:
  //   Excalidraw scene-element IDs → registry annotation entries (Bug A)
  //   registry visibility flips → opacity rewrite (annotation) / setLayoutProperty (data) (Bug B)
  useLayerRegistrySync(map, excalidrawAPI);

  // Derive pointer-events gate from active Excalidraw tool (Flow B decision node).
  // isDrawingMode=true → Excalidraw captures events; false → events pass to MapLibre.
  const { isDrawingMode } = useToolState(excalidrawAPI);

  // Atlas-side tool dispatcher (PinTool & friends). When `activeAtlasTool` is
  // non-null, the interaction overlay below mounts above Excalidraw and
  // captures pointerdown — converting it into a `ToolPointerEvent` that the
  // active tool consumes via its onPointerDown handler.
  const { activeAtlasTool, setActiveAtlasTool, dispatchPointerDown } =
    useAtlasdrawTool(map, excalidrawAPI);
  const isPinActive = activeAtlasTool?.id === "pin";

  // Tool options bar — scaleMode tracks the active tool's default, user can
  // toggle per-session. Resets to the tool's default when tool changes.
  const [toolScaleMode, setToolScaleMode] = useState<ScaleMode>("geographic");
  useEffect(() => {
    if (activeAtlasTool) {
      setToolScaleMode(activeAtlasTool.defaultScaleMode);
    }
  }, [activeAtlasTool?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard shortcuts panel — toggled with `?`.
  const [showShortcuts, setShowShortcuts] = useState(false);
  // Quick-actions palette — Cmd+K / Ctrl+K.
  const [showQuickActions, setShowQuickActions] = useState(false);
  // Onboarding — shown on first visit only.
  const onboarding = useOnboarding();

  // Keyboard shortcuts (Cmd+K quick actions, Cmd+S/Cmd+O save/open, `?`
  // shortcuts panel, Escape to dismiss) — extracted to useMapEditorKeyboard.
  useMapEditorKeyboard({
    spaceHeldRef,
    excalidrawAPI,
    showShortcuts,
    setShowShortcuts,
    setShowQuickActions,
    onSave: (api) => void saveAtlasDocument(api, documentNotify),
    onOpen: (api) => void openAtlasDocument(api, documentNotify),
  });

  // T9 — subscribe to the persistence dirty flag for the MainMenu indicator.
  // Selector form so the component re-renders ONLY on isDirty flips, not on
  // store/dispose pointer changes.
  const isDirty = usePersistenceStore((s) => s.isDirty);

  // T13 — data-file drag-and-drop import (extracted to useDataFileImport
  // hook). ISSUES.md Direction 1: also exposes importFile() for the
  // deliberate "Import…" menu action below (native file picker), so both
  // trigger paths funnel through the same parse+dispatch pipeline.
  const registry = useLayerRegistry();
  const { importFile } = useDataFileImport(
    rootRef,
    map,
    registry.registerDataLayer,
  );

  // ISSUES.md Direction 1 — "Import…" menu action. Mirrors the hidden-
  // <input type="file"> pattern in state/persistence.ts's fallbackOpen:
  // create it off-DOM, click it programmatically, clean up once settled.
  // .accept covers all three formats useDataFileImport understands so one
  // picker serves GeoJSON/CSV/Shapefile alike — drag-drop already handles
  // GeoJSON/CSV; this is the discoverable, menu-driven equivalent, and the
  // only reachable path for Shapefile today.
  const handleImportFile = useCallback(() => {
    if (typeof document === "undefined") {
      return;
    }
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".geojson,.csv,.zip";
    input.style.display = "none";
    let settled = false;
    const settle = () => {
      if (settled) {
        return;
      }
      settled = true;
      if (input.parentNode) {
        input.parentNode.removeChild(input);
      }
    };
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      settle();
      if (file) {
        importFile(file);
      }
    });
    input.addEventListener("cancel", settle);
    document.body.appendChild(input);
    input.click();
  }, [importFile]);

  // Phase 5 Task 9 — Collab data layer: renders the live Yjs FeatureCollection
  // as a MapLibre source+layer (extracted to useCollabDataLayer hook).
  useCollabDataLayer(map, yjsLayer.features);

  // W-C — Convert annotation → data layer, via the element right-click
  // context menu (registered internally). Extracted to useConvertToDataLayer
  // hook; its returned currentConvertibleSelection/handleConvert pair has no
  // consumer here today (no MainMenu item wires it — see the hook's header).
  useConvertToDataLayer(map, excalidrawAPI, registry, toast);

  // Register the LayerPanel as a tab inside Excalidraw's DefaultSidebar
  // (the sidebar that hosts Library + canvas Search). Replaces the
  // previous parallel `<Sidebar name="layers">` mount: shares the
  // existing trigger button, dock state, and tab routing instead of
  // requiring a custom MainMenu open-action and a second sidebar
  // surface. The MainMenu "Layers panel" item below addresses this
  // tab via `toggleSidebar({name: DEFAULT_SIDEBAR.name, tab: "layers"})`.
  useEffect(() => {
    if (!excalidrawAPI) {
      return;
    }
    return excalidrawAPI.registerSidebarTab({
      name: "layers",
      label: "Layers",
      icon: (
        <svg
          width={16}
          height={16}
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="1" y="3" width="14" height="3" rx="0.5" />
          <rect x="3" y="8" width="12" height="3" rx="0.5" />
          <rect x="5" y="13" width="10" height="3" rx="0.5" />
          <path d="M2 4.5v6" />
          <path d="M4 9.5v4" />
        </svg>
      ),
      content: <LayerPanel />,
    });
  }, [excalidrawAPI]);

  // Phase 6 A3 — anchored comments Sidebar tab. Same DefaultSidebar surface
  // as Layers; opens via toggleSidebar({name: DEFAULT_SIDEBAR.name, tab:
  // "comments"}). CommentsPanelHost wires useCollab().commentsLayer
  // internally and renders body markup only.
  useEffect(() => {
    if (!excalidrawAPI) {
      return;
    }
    return excalidrawAPI.registerSidebarTab({
      name: "comments",
      label: "Comments",
      icon: (
        <svg
          width={16}
          height={16}
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M2 3h12a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H9l-3 3v-3H2a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
          <path d="M5 7h6M5 9h4" />
        </svg>
      ),
      content: <CommentsPanelHost />,
    });
  }, [excalidrawAPI]);

  // W-B — Composite PNG export (extracted to useExportPNG hook).
  const handleExportPNG = useExportPNG(map, excalidrawAPI, mapBg, toast);

  // Export callbacks for ExportDialog — wraps existing handlers.
  const handleExportGeoJSON = useCallback(() => {
    if (!excalidrawAPI) {
      return;
    }
    const elements = excalidrawAPI.getSceneElements();
    const fc = buildGeoJsonExport(elements);
    const json = JSON.stringify(fc, null, 2);
    const blob = new Blob([json], { type: "application/geo+json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `atlasdraw-${Date.now()}.geojson`;
    a.click();
    URL.revokeObjectURL(url);
  }, [excalidrawAPI]);

  const handleExportAtlasdraw = useCallback(() => {
    // Same single door as the MainMenu "Save" item and Cmd+S — the
    // .atlasdraw card is just another entry point to it.
    void saveAtlasDocument(excalidrawAPI, documentNotify);
  }, [excalidrawAPI, documentNotify]);

  // Excalidraw onChange: background intercept + scroll-lock/space-pan bridge
  // + post-load geo sync + autosave markDirty + aria-live selection announce
  // — extracted to useExcalidrawChangeHandler hook.
  const handleExcalidrawChange = useExcalidrawChangeHandler({
    excalidrawAPI,
    map,
    syncNow: syncNow ?? undefined,
    announceMapEditor,
    setMapBg,
    spaceHeldRef,
  });

  // Provide the live MapLibre canvas to Excalidraw's native Save as Image /
  // Copy as PNG so they composite basemap + annotations in a single export.
  const getBackgroundCanvas = useCallback(
    (): HTMLCanvasElement | null => (map ? map.getCanvas() : null),
    [map],
  );

  // "Scroll back to content" reframes the MAP on the geographic bounds of the
  // drawn content — Excalidraw's canvas is scroll-locked (the map is the
  // camera), so its default calculateScrollCenter is a no-op here. Returns true
  // when handled so the vendored button skips that default. CoordinateSync then
  // re-projects the elements onto the reframed map (a plain camera move — no
  // change to the reprojection math).
  const handleScrollBackToContent = useCallback(
    (elements: readonly ExcalidrawElement[]): boolean =>
      fitMapToContent(map, elements),
    [map],
  );

  return (
    <CollabContext.Provider value={collabValue}>
      {/* Collar shell (variant A) — the printed map-sheet frame. The plate
        (children) hosts the MapLibre + Excalidraw stack; head bar carries
        the wordmark, sheet name and geo-search; marginalia grows out of
        StatusBar in the foot row. */}
      <CollarShell
        map={map}
        sheetName="Untitled atlasdraw"
        headExtras={<GeoSearchControl map={map} variant="collar" />}
        foot={<StatusBar map={map} />}
      >
        <div
          ref={rootRef}
          className={styles.root}
          style={{ backgroundColor: mapBg }}
          data-testid="map-editor-root"
        >
          {/* Bottom layer: MapLibre GL map */}
          <div className={styles.mapLayer}>
            <MapCanvas
              initialView={initialView}
              onMapReady={onMapReady}
              className={styles.fullSize}
            />
          </div>

          {/* Top layer: Excalidraw canvas, transparent background.
          pointer-events: none (from .excalidrawLayer) — toggled to auto via
          .excalidrawLayerActive when isDrawingMode is true (Flow B gate). */}
          <div
            className={[
              styles.excalidrawLayer,
              isDrawingMode ? styles.excalidrawLayerActive : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <Excalidraw
              initialData={EXCALIDRAW_INITIAL_DATA}
              gridModeEnabled={false}
              onExcalidrawAPI={(api) => setExcalidrawAPI(api)}
              onChange={handleExcalidrawChange}
              getBackgroundCanvas={getBackgroundCanvas}
              UIOptions={EXCALIDRAW_UI_OPTIONS}
              // Geo-search moved to the Collar head bar (see <CollarShell
              // headExtras> above) — the collar variant of the same control.
              onScrollBackToContent={handleScrollBackToContent}
            >
              {/* LayerPanel mounts as a tab inside DefaultSidebar via
              registerSidebarTab (see useEffect above). No <Sidebar> child
              here — DefaultSidebar's trigger button + dockable shell are
              shared. */}

              {/* MainMenu — passing <MainMenu> as a child of <Excalidraw>
              REPLACES the default menu via tunnel (MainMenu.tsx:30 +
              LayerUI.tsx:109-126). To preserve Excalidraw's hardwon
              menu, we render its DefaultItems alongside our atlas
              additions. Order mirrors LayerUI's default with atlas
              items inserted into logical groups. */}
              <MainMenu>
                {/* One format, one door: the .atlasdraw bundle is the only
                save/open surface. Excalidraw's LoadScene/SaveToActiveFile/
                Export defaults are disabled via EXCALIDRAW_UI_OPTIONS;
                Cmd+O / Cmd+S route to these same handlers (onKeyDown). */}
                <MainMenu.Item
                  onSelect={() =>
                    void openAtlasDocument(excalidrawAPI, documentNotify)
                  }
                  data-testid="main-menu-open"
                >
                  Open…
                </MainMenu.Item>
                <MainMenu.Item
                  onSelect={() =>
                    void saveAtlasDocument(excalidrawAPI, documentNotify)
                  }
                  data-testid="main-menu-save"
                >
                  Save
                </MainMenu.Item>
                <MainMenu.Item
                  onSelect={() => setShowAboutDialog(true)}
                  data-testid="main-menu-about"
                >
                  ℹ About Atlasdraw
                </MainMenu.Item>
                {/* Phase 4 T8 — Share link. Root-level mounted (same pattern as
                AboutDialog) so MainMenu auto-close doesn't unmount the
                dialog before the link is copied. */}
                <MainMenu.Item
                  onSelect={() => setShowShareDialog(true)}
                  data-testid="main-menu-share"
                >
                  🔗 Share map
                </MainMenu.Item>
                <MainMenu.Separator />
                {isDirty && (
                  <MainMenu.Item
                    onSelect={() => {
                      /* indicator-only; no action */
                    }}
                    data-testid="main-menu-unsaved-indicator"
                    aria-label="Unsaved changes"
                  >
                    ● Unsaved
                  </MainMenu.Item>
                )}
                <MainMenu.Item
                  onSelect={handleImportFile}
                  data-testid="main-menu-import"
                >
                  Import…
                </MainMenu.Item>
                <MainMenu.Item
                  onSelect={() => setShowExport(true)}
                  data-testid="main-menu-export"
                >
                  Export…
                </MainMenu.Item>
                <MainMenu.Item
                  onSelect={() => setShowSettings(true)}
                  data-testid="main-menu-settings"
                >
                  Settings…
                </MainMenu.Item>
                <MainMenu.Separator />
                <MainMenu.Item
                  onSelect={() =>
                    setActiveAtlasTool(isPinActive ? null : PinTool)
                  }
                  data-testid="main-menu-pin"
                  aria-pressed={isPinActive}
                >
                  {isPinActive ? "✓ Pin to map" : "Pin to map"}
                </MainMenu.Item>
                <MainMenu.Item
                  onSelect={() =>
                    excalidrawAPI?.toggleSidebar({
                      name: DEFAULT_SIDEBAR.name,
                      tab: "layers",
                    })
                  }
                  data-testid="main-menu-layers"
                >
                  Layers panel
                </MainMenu.Item>
                <MainMenu.Separator />
                <MainMenu.DefaultItems.SearchMenu />
                {/* Atlasdraw's own Help entry — not MainMenu.DefaultItems.Help,
                which opens Excalidraw's vendored HelpDialog (links to
                docs.excalidraw.com / github.com/excalidraw / Excalidraw+)
                and collides with our own "?" shortcut binding above. */}
                <MainMenu.Item
                  onSelect={() => setShowShortcuts(true)}
                  data-testid="main-menu-shortcuts"
                >
                  Keyboard shortcuts
                </MainMenu.Item>
                <MainMenu.DefaultItems.ClearCanvas />
                {/* Phase 4 T6 — Basemap picker replaces the canvas background
                picker. Previously ChangeCanvasBackground set a solid color
                behind Excalidraw; now we switch the MapLibre basemap style.
                The dialog is rendered inside the Excalidraw tree so it
                inherits focus trap + Escape handling from the vendored
                Dialog primitive (atlasdraw-50c0). */}
                <MainMenu.Item
                  onSelect={() => setShowBasemapPicker(true)}
                  data-testid="main-menu-basemap"
                >
                  {(() => {
                    const active = getBasemap(activeBasemapId);
                    if (!active) {
                      return "🗺 Basemap";
                    }
                    const source = active.requiresRemote ? "Remote" : "Local";
                    return `🗺 Basemap: ${active.label} · ${source}`;
                  })()}
                </MainMenu.Item>
                {/* Phase 6 A4 — "Edit basemap style" opens the Maputnik modal,
                pointed at the active basemap's vendored style JSON URL. */}
                <MainMenu.Item
                  onSelect={() => setMaputnikOpen(true)}
                  data-testid="main-menu-edit-style"
                >
                  Edit basemap style
                </MainMenu.Item>
                {/* Phase 6 A12 — Asset library info panel. Pushes the 3 bundled
                atlas fixtures (wildfire / transit / hazard) into Excalidraw's
                built-in library via updateLibrary; the dialog itself just
                lists what's available + a button to open Excalidraw's library
                sidebar tab. Root-level mounted (same pattern as Maputnik /
                Basemap pickers) so MainMenu auto-close doesn't unmount it. */}
                <MainMenu.Item
                  onSelect={() => setShowAssetLibrary(true)}
                  data-testid="main-menu-asset-library"
                >
                  Asset library
                </MainMenu.Item>
                <MainMenu.DefaultItems.ToggleTheme />
              </MainMenu>
            </Excalidraw>
          </div>

          {/* Phase 6 A3 — anchored comment overlay. Iterates the live
          CommentsLayer and renders one bubble per unresolved comment,
          projected to screen coords. Doubles as the pending-anchor picker
          (next map click or single-element selection). z-index 10 (toolbar
          band); the container is pointer-events: none so non-anchor clicks
          pass through. */}
          <CommentAnchorsOverlay map={map} excalidrawAPI={excalidrawAPI} />

          {/* Phase 5 T11 — collab cursor + presence UI. Gated on collab.active
          (no-op for single-player deployments, Q1). Both components already
          no-op internally when there are no peers; the active gate just
          skips mounting them at all when realtime is disabled. Wiring was
          orphaned when CollabWrapper (the original Task 11 mount point) was
          deleted 2026-05-25 as an unused gateway — see ledgers/DEADWOOD.md. */}
          {collabValue.active && (
            <>
              <CursorOverlay />
              {/* PresenceList shares WorkspaceSwitcher's top-right z:10 slot
              (top:12/right:12) — offset below it in managed mode so the two
              don't overlap when both are showing (hosted collab session). */}
              <PresenceList
                topOffset={getAppConfig().managed ? 56 : undefined}
              />
            </>
          )}

          {/* Phase 6 A13a — workspace switcher. Self-host (managed=false)
          renders null; managed-mode renders a top-right dropdown that
          lists workspaces and routes free-tier users to /billing for an
          upgrade. The HTTP client is the same shared instance used by
          ShareDialog so X-Workspace-ID flows through autosave too. */}
          <WorkspaceSwitcher
            client={getShareClient()}
            activeId={activeWorkspaceId}
            onSelect={(id) => setActiveWorkspaceId(asWorkspaceId(id))}
          />

          {/* Atlas-tool interaction overlay — only mounted when an atlas-tool is
          active. Captures pointerdown above Excalidraw (zIndex 5) so map clicks
          flow into our tool dispatcher instead of becoming Excalidraw selection
          rectangles. Unmounted otherwise so map pan/zoom is unaffected. */}
          {activeAtlasTool && (
            <>
              <div
                className={styles.atlasToolOverlay}
                data-testid="atlas-tool-overlay"
                onPointerDown={(reactEvent) => {
                  dispatchPointerDown({
                    clientX: reactEvent.clientX,
                    clientY: reactEvent.clientY,
                    pointerId: reactEvent.pointerId,
                    pointerType:
                      (reactEvent.pointerType as "mouse" | "pen" | "touch") ??
                      "mouse",
                    button: reactEvent.button,
                    shiftKey: reactEvent.shiftKey,
                    altKey: reactEvent.altKey,
                    ctrlKey: reactEvent.ctrlKey,
                    metaKey: reactEvent.metaKey,
                  });
                }}
                style={{ cursor: activeAtlasTool.cursor }}
              />
              <ToolOptionsBar
                tool={activeAtlasTool}
                scaleMode={toolScaleMode}
                onScaleModeChange={setToolScaleMode}
              />
            </>
          )}

          {/* Phase 4 T6 — Basemap picker. Rendered at the root level (NOT inside
          MainMenu) so MainMenu auto-close on item click doesn't unmount it.
          The dialog manages its own focus trap, Escape, and click-outside. */}
          {showBasemapPicker && (
            <BasemapPickerDialog
              activeId={activeBasemapId}
              onSelect={setActiveBasemapId}
              onCloseRequest={() => setShowBasemapPicker(false)}
            />
          )}

          {/* Phase 6 A12 — Asset library info panel. Same root-level pattern as
          the basemap picker / Maputnik modal — MainMenu auto-close on item
          click would otherwise unmount it. Panel mounts → pushes the 3
          bundled .excalidrawlib fixtures into Excalidraw's built-in library
          via updateLibrary({ libraryItems, merge: true }); button opens
          Excalidraw's library sidebar tab so the user can browse + stamp. */}
          {showAssetLibrary && (
            <AssetLibraryPanel
              excalidrawAPI={excalidrawAPI}
              onCloseRequest={() => setShowAssetLibrary(false)}
            />
          )}

          {/* Phase 6 A4 — Maputnik "Edit basemap style" modal. Hosted at the root
          level (same pattern as the basemap picker) so MainMenu auto-close
          doesn't unmount it. Iframe sandbox is intentionally restrictive —
          see MaputnikDialog header comment for security posture. */}
          {maputnikOpen &&
            (() => {
              const active = getBasemap(activeBasemapId);
              const styleFile = active?.styleFile ?? "protomaps-light.json";
              const origin =
                typeof window !== "undefined" ? window.location.origin : "";
              const activeStyleUrl = `${origin}/styles/${styleFile}`;
              return (
                <MaputnikDialog
                  activeStyleUrl={activeStyleUrl}
                  maputnikUrl={getAppConfig().maputnikUrl}
                  onCloseRequest={() => setMaputnikOpen(false)}
                />
              );
            })()}

          {/* Phase 4 T14 — AboutDialog. Same root-level pattern as the basemap
          picker so MainMenu auto-close doesn't unmount it. */}
          {showAboutDialog && (
            <AboutDialog onCloseRequest={() => setShowAboutDialog(false)} />
          )}

          {/* Settings — tabbed modal replacing standalone BasemapPickerDialog. */}
          {showSettings && (
            <SettingsDialog
              activeBasemapId={activeBasemapId}
              onBasemapChange={setActiveBasemapId}
              onCloseRequest={() => setShowSettings(false)}
              workspaceId={activeWorkspaceId ?? undefined}
            />
          )}

          {/* Export — unified export surface (PNG / PDF / GeoJSON / .atlasdraw). */}
          {showExport && (
            <ExportDialog
              onCloseRequest={() => setShowExport(false)}
              onExportPNG={handleExportPNG}
              onExportPDF={() => setShowPrintDialog(true)}
              onExportGeoJSON={handleExportGeoJSON}
              onExportAtlasdraw={handleExportAtlasdraw}
            />
          )}

          {/* Phase 4 T8 — ShareDialog. Mounted only when excalidrawAPI is ready
          (selectDocument needs the imperative API). Phase 5 collab integration:
          opens to a mode picker (read-only / Collaborate) instead of auto-
          firing the read-only generate. Receives the editor's CollabState so
          the Collaborate path reuses the same socket as the editor. */}
          {showShareDialog && excalidrawAPI && (
            <ShareDialog
              onCloseRequest={() => setShowShareDialog(false)}
              getDoc={() =>
                selectDocument(excalidrawAPI, useLayerRegistryStore.getState())
              }
              client={getShareClient()}
              collabState={collabState}
            />
          )}

          {/* Phase 6 A10 — PrintDialog (PDF export). Root-level mount so the
          MainMenu auto-close on item-select doesn't unmount the dialog.
          getMapCanvas returns the live MapLibre canvas at submit time, so
          the PDF reflects the user's current viewport (not the moment the
          dialog opened). Legend entries are derived from the layer
          registry: annotation entries have no color of their own → use a
          neutral grey; data layers carry style.fillColor. */}
          {showPrintDialog && (
            <PrintDialog
              getMapCanvas={() => map?.getCanvas() ?? null}
              layers={useLayerRegistryStore
                .getState()
                .entries.map<LayerLegendEntry>((e) => ({
                  id: e.id,
                  name: e.label,
                  color:
                    e.kind === "data"
                      ? e.style.fillColor ?? "#868e96"
                      : "#868e96",
                }))}
              onCloseRequest={() => setShowPrintDialog(false)}
            />
          )}

          {/* Phase 5 collab integration — inline banner when the URL fragment
          carries a malformed `#room:` link. Surfaces useCollabRoom's parse
          error to the user without blocking the editor. */}
          {collabRoomError && (
            <div
              data-testid="collab-room-error"
              role="alert"
              style={{
                position: "absolute",
                top: 12,
                left: "50%",
                transform: "translateX(-50%)",
                zIndex: 10,
                background: "var(--ad-danger, #d64045)0d",
                border:
                  "1px solid color-mix(in srgb, var(--ad-danger, #d64045) 25%, transparent)",
                color: "var(--ad-danger, #c92a2a)",
                padding: "6px 12px",
                borderRadius: "var(--ad-radius-md, 6px)",
                fontSize: 13,
                boxShadow:
                  "var(--ad-shadow-tracing, 0 1px 3px rgba(0,0,0,0.12))",
              }}
            >
              {collabRoomError}
            </div>
          )}

          {onboarding.show && <OnboardingTips onDismiss={onboarding.dismiss} />}

          {showShortcuts && (
            <KeyboardShortcuts onClose={() => setShowShortcuts(false)} />
          )}

          {showQuickActions && (
            <QuickActions
              actions={[
                {
                  id: "pin",
                  label: "Pin to map",
                  category: "Tools",
                  hint: "P",
                  keywords: ["marker", "point"],
                  onSelect: () => setActiveAtlasTool(PinTool),
                },
                {
                  id: "layers",
                  label: "Layers panel",
                  category: "View",
                  keywords: ["sidebar"],
                  onSelect: () =>
                    excalidrawAPI?.toggleSidebar({
                      name: DEFAULT_SIDEBAR.name,
                      tab: "layers",
                    }),
                },
                {
                  id: "comments",
                  label: "Comments panel",
                  category: "View",
                  keywords: ["sidebar", "threads"],
                  onSelect: () =>
                    excalidrawAPI?.toggleSidebar({
                      name: DEFAULT_SIDEBAR.name,
                      tab: "comments",
                    }),
                },
                {
                  id: "export-png",
                  label: "Export composite PNG",
                  category: "Export",
                  hint: "⌘⇧E",
                  keywords: ["image", "screenshot", "composite"],
                  onSelect: handleExportPNG,
                },
                {
                  id: "export-pdf",
                  label: "Export PDF",
                  category: "Export",
                  keywords: ["print", "document"],
                  onSelect: () => setShowPrintDialog(true),
                },
                {
                  id: "open",
                  label: "Open map…",
                  category: "File",
                  hint: "⌘O",
                  keywords: [
                    "load",
                    "file",
                    "atlasdraw",
                    "excalidraw",
                    "import",
                  ],
                  onSelect: () =>
                    void openAtlasDocument(excalidrawAPI, documentNotify),
                },
                {
                  id: "save",
                  label: "Save map",
                  category: "File",
                  hint: "⌘S",
                  keywords: ["disk", "file", "atlasdraw"],
                  onSelect: () =>
                    void saveAtlasDocument(excalidrawAPI, documentNotify),
                },
                {
                  id: "share",
                  label: "Share map",
                  category: "File",
                  keywords: ["link", "collaborate", "invite"],
                  onSelect: () => setShowShareDialog(true),
                },
                {
                  id: "basemap",
                  label: "Change basemap",
                  category: "View",
                  keywords: ["style", "tiles", "background"],
                  onSelect: () => setShowBasemapPicker(true),
                },
                {
                  id: "about",
                  label: "About Atlasdraw",
                  category: "Help",
                  keywords: ["version", "license"],
                  onSelect: () => setShowAboutDialog(true),
                },
                {
                  id: "shortcuts",
                  label: "Keyboard shortcuts",
                  category: "Help",
                  hint: "?",
                  keywords: ["keys", "hotkeys"],
                  onSelect: () => setShowShortcuts(true),
                },
              ]}
              onClose={() => setShowQuickActions(false)}
            />
          )}
        </div>
      </CollarShell>
    </CollabContext.Provider>
  );
}
