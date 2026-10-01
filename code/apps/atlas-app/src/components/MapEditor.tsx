/**
 * MapEditor — the editor: MapLibre GL (bottom) and a transparent Excalidraw
 * (top) stacked in one container, inside the collar.
 *
 * Who takes the pointer: every Excalidraw tool except the hand tool captures
 * pointer events (classifyTool, decision atlasdraw-dd91), so a drag with the
 * selection tool selects. The hand tool lets the pointer through to the map,
 * and Space+drag pans with any tool. Wheel and pinch always go to the map
 * (useMapWheelRouter).
 *
 * The map owns the camera; Excalidraw's scroll and zoom follow it
 * (useCameraBridge, ADR-0015). A drawn element is stored in world
 * coordinates, so no camera move rewrites it.
 *
 * `onMount` fires once when both the map and the Excalidraw API exist.
 */

import { useStore } from "zustand";
import React, {
  Suspense,
  lazy,
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
} from "react";
import { MapCanvas } from "@atlasdraw/basemap";

import { getBasemap } from "@atlasdraw/basemap";

import { Excalidraw, MainMenu } from "@atlasdraw/excalidraw";

import { CANVAS_SEARCH_TAB, DEFAULT_SIDEBAR } from "@atlasdraw/common";

import { PinTool, drawingToFeatureCollection } from "@atlasdraw/tools";

import { toLngLat, toScene } from "@atlasdraw/geo";

import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw";

import type { MapCanvasInitialView } from "@atlasdraw/basemap";

import { useMapRef } from "../hooks/useMapRef";
import { useConvertToDataLayer } from "../hooks/useConvertToDataLayer";
import { usePersistenceWiring } from "../hooks/usePersistenceWiring";
import { useMapEditorKeyboard } from "../hooks/useMapEditorKeyboard";
import { useExcalidrawChangeHandler } from "../hooks/useExcalidrawChangeHandler";
import { useCameraBridge } from "../hooks/useCameraBridge";
import { seedShapes } from "../lib/devSeedShapes";
import { useMapOverlays } from "../hooks/useMapOverlays";
import { useFeaturePopup, type PopupMap } from "../hooks/useFeaturePopup";
import { useCanvasClickThrough } from "../hooks/useCanvasClickThrough";
import { useToolState } from "../hooks/useToolState";
import { useCameraRotation } from "../hooks/useCameraRotation";
import { useAtlasdrawTool } from "../hooks/useAtlasdrawTool";
import { useCommentModeTool } from "../hooks/useCommentModeTool";
import { useOpenThreadCountFor } from "../hooks/useOpenThreadCount";
import { useCommentSearchSources } from "../hooks/useCommentSearchSources";
import { useMapWheelRouter } from "../hooks/useMapWheelRouter";
import { useRoom } from "../hooks/useRoom";
import { useBrowserTabTitle } from "../hooks/useBrowserTabTitle";
import { useDataFileImport } from "../hooks/useDataFileImport";
import { useExportPNG } from "../hooks/useExportPNG";
import { useBasemapStyle } from "../hooks/useBasemapStyle";
import { useServerBackup } from "../hooks/useServerBackup";

import { LayersIcon } from "../lib/icons";

import { usePersistenceStore } from "../state/usePersistenceStore";
import { isOverlayId } from "../state/selectedLayer";
import { useSceneBinding } from "../state/scene";
import { annotationRows } from "../state/annotations";
import {
  currentDocument,
  dispatch,
  useDocument,
  useDocumentStore,
} from "../state/document";
import { liveCamera, toFile } from "../state/documentIO";
import { configuredTransport } from "../state/room";
import { editorScene } from "../state/scene";
import { createSession } from "../session/EditorSession";
import { SessionProvider } from "../session/SessionContext";
import { openMap, saveMap, type Notify } from "../session/fileActions";
import { getAppConfig } from "../config/app-config";
import { type SharedMap } from "../routes";
import { featureAt } from "../lib/featureHit";
import {
  createHttpStorageClient,
  type HttpStorageClient,
} from "../services/createHttpStorageClient";

import styles from "../styles/MapEditor.module.css";

import { exportCompositeDataURL, measureView } from "../lib/export";

import { exportLegendEntries } from "../lib/legend";
import {
  geoJsonExportFile,
  type GeoJsonExportOptions,
} from "../lib/dataLayerExport";
import { downloadBlob } from "../lib/download";

import { useToast } from "./ToastProvider";

import { CollarShell } from "./CollarShell";
import { SheetRail } from "./SheetRail";
import { SheetPanelResizer } from "./SheetPanelResizer";
import { SheetNameField } from "./SheetNameField";
import { ShareDialog } from "./ShareDialog";
import { ConfirmDialog } from "./ConfirmDialog";
import { MyMapsDialog } from "./MyMapsDialog";
import { AssetLibraryPanel } from "./AssetLibraryPanel";
import { CommentAnchorsOverlay } from "./CommentAnchorsOverlay";
import { FeaturePopup } from "./FeaturePopup";
import { CursorOverlay } from "./CursorOverlay";
import { PresenceList } from "./PresenceList";
import { StatusBar } from "./StatusBar";
import { GeoSearchControl } from "./GeoSearchControl";
import { MapCompass } from "./MapCompass";
import { PinToolButton } from "./PinToolButton";
import { MeasureToolButton } from "./MeasureToolButton";
import { MeasureLayer } from "./MeasureLayer";
import { CommentModeButton } from "./CommentModeButton";
import { ToolOptionsBar } from "./ToolOptionsBar";
import { KeyboardShortcuts } from "./KeyboardShortcuts";
import { QuickActions } from "./QuickActions";
import { LayerPanel } from "./LayerPanel";
import { useAnnounce } from "./AriaAnnouncer";
import { OnboardingTips, useOnboarding } from "./OnboardingTips";

import type { ExportFormat } from "./ExportDialog";

import type { LayerLegendEntry } from "../lib/print-pdf";
import type { DocumentCommand, RasterLayerEntry } from "../state/document";

import type maplibregl from "maplibre-gl";

// Four modal dialogs, every one behind a click and already conditionally
// rendered. Loading them eagerly put their whole dependency tree — pdf-lib
// most of all, reached through ExportDialog -> lib/print-pdf — into the boot
// chunk of a user who may never open Export. Each render site below carries
// its own <Suspense fallback={null}>: a modal that appears a frame later is
// invisible to the user, and a spinner over a dialog that has not opened yet
// would be worse than nothing.
const AboutDialog = lazy(() =>
  import("./AboutDialog").then((m) => ({ default: m.AboutDialog })),
);
const SettingsDialog = lazy(() =>
  import("./SettingsDialog").then((m) => ({ default: m.SettingsDialog })),
);
const ExportDialog = lazy(() =>
  import("./ExportDialog").then((m) => ({ default: m.ExportDialog })),
);

// Ray-casting point-in-polygon test on projected (screen) coordinates. Used by
// the map-click handler to hit-test raster layers, whose corners are
// projected to screen space with MapLibre's `map.project` before testing.
function pointInPolygon(
  point: { x: number; y: number },
  polygon: { x: number; y: number }[],
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const yiAbove = yi > point.y;
    const yjAbove = yj > point.y;
    if (
      yiAbove !== yjAbove &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi
    ) {
      inside = !inside;
    }
  }
  return inside;
}

// Module-scoped so the Excalidraw mount sees a stable identity. Excalidraw
// reads initialData once on mount; passing a fresh literal each render is
// harmless today but brittle if a future Excalidraw version memoizes on it.
const EXCALIDRAW_INITIAL_DATA = {
  appState: {
    viewBackgroundColor: "transparent",
    // The sheet panel is the plate's right MARGIN, not a floating overlay —
    // "nothing floats over the map at rest" (.interface-design/system.md).
    // Docked is also the only state in which the editor reserves a column for
    // it, which is what lets the map reflow instead of being covered. The dock
    // toggle in the panel header still works; this is the default, not a lock,
    // and it is a *preference* key so a user who undocks keeps that choice.
    defaultSidebarDockedPreference: true,
  },
} as const;

// One format, one door: disable Excalidraw's own persistence and export
// (.excalidraw load/save, the JSONExportDialog, the image export dialog).
// These keys also close the matching shortcuts (Cmd+Shift+S, Cmd+Shift+E)
// and command-palette entries, so Cmd+O / Cmd+S fall through to the atlas
// handlers in useMapEditorKeyboard. Tested in the fork:
// packages/excalidraw/tests/closedExportDoors.test.tsx.
const EXCALIDRAW_UI_OPTIONS = {
  canvasActions: {
    loadScene: false,
    saveToActiveFile: false,
    export: false as const,
    saveAsImage: false,
    // One help surface: `?` reaches useMapEditorKeyboard, which opens
    // KeyboardShortcuts. Tested in the fork: closedHelpDoor.test.tsx.
    toggleShortcuts: false,
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

  /** A shared map to open as a copy when the editor starts (routes.ts). */
  open?: SharedMap | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MapEditor({ initialView, onMount, open }: MapEditorProps) {
  const [session] = useState(() =>
    createSession({
      store: useDocumentStore,
      scene: editorScene,
      transport: configuredTransport(),
    }),
  );
  const { map, onMapReady } = useMapRef();
  const [excalidrawAPI, setExcalidrawAPI] =
    useState<ExcalidrawImperativeAPI | null>(null);
  const toast = useToast();

  useEffect(() => {
    session.view.getState().setMap(map);
    return () => session.view.getState().setMap(null);
  }, [session, map]);
  useEffect(() => {
    session.view.getState().setApi(excalidrawAPI);
    return () => session.view.getState().setApi(null);
  }, [session, excalidrawAPI]);

  // --- sheet panel: width, and whether the plate reflows for it -------------
  //
  // Width is the app's, kept in the session view and published back
  // into the editor as `rightSidebarWidth` (which becomes
  // `--right-sidebar-width`). `sheetPanelLayout` comes the other way, from the
  // editor's own `isUIShrunkForSidebar` — the one expression that also drives
  // the UI-wrapper narrowing and the collar legend's offset, so the map's
  // reflow can't drift out of step with them the way a re-derived copy would.
  const sheetPanelWidth = useStore(session.view, (s) => s.sheetPanelWidth);
  const { setSheetPanelWidth, resetSheetPanelWidth } = session.view.getState();
  const [sheetPanelLayout, setSheetPanelLayout] = useState({
    open: false,
    shrunk: false,
    collar: false,
  });
  // Stable identity: `<Excalidraw>`'s memo comparator is a shallow prop compare,
  // so a fresh closure here would defeat it on every MapEditor render.
  const onSidebarLayoutChange = useCallback(
    (layout: { open: boolean; shrunk: boolean; collar: boolean }) => {
      setSheetPanelLayout((prev) =>
        prev.open === layout.open &&
        prev.shrunk === layout.shrunk &&
        prev.collar === layout.collar
          ? prev
          : layout,
      );
    },
    [],
  );
  // The plate only gives up pixels when the editor has actually reserved a
  // column (docked + wide enough). An undocked panel floats, exactly as
  // upstream Excalidraw does, and the map keeps its full width.
  const platePanelInset = sheetPanelLayout.shrunk ? sheetPanelWidth : 0;

  // Stable outcome channel for save/open.
  const documentNotify = useMemo<Notify>(
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
  // That path puts the color into the MapLibre canvas itself. CSS on root is
  // sufficient for now because the composite export (lib/export.ts) takes
  // `backgroundColor` and paints it under the map canvas.
  const [mapBg, setMapBg] = useState("transparent");
  const activeBasemapId = useDocument((s) => s.basemap);
  const [showAboutDialog, setShowAboutDialog] = useState(false);
  const [showShareDialog, setShowShareDialog] = useState(false);
  // Phase 6 A12 — Asset library info panel + dialog. Pushes the 3 bundled
  // .excalidrawlib fixtures (wildfire / transit / hazard) into Excalidraw's
  // built-in library via updateLibrary({ libraryItems, merge: true }).
  const [showAssetLibrary, setShowAssetLibrary] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  // Unified export surface — non-null opens the dialog with that format
  // card preselected ("png" from the menu, "pdf" from quick actions).
  // The PDF path lives inside ExportDialog now; the former chained
  // PrintDialog modal is gone.
  const [exportDialogFormat, setExportDialogFormat] =
    useState<ExportFormat | null>(null);
  // Rooms (hooks/useRoom.ts): a `#room:` link joins one when the editor is
  // ready; Share → Collaborate makes one from this map.
  const roomSession = useRoom(excalidrawAPI, map, session.transport);
  useEffect(() => {
    if (roomSession.status === "joined") {
      toast.success(
        "You are in a shared map. Your own map stays saved and unchanged.",
      );
    }
  }, [roomSession.status, toast]);
  const roomProblem =
    roomSession.error ??
    (roomSession.status === "denied"
      ? "This shared map link was refused. Ask for a new link."
      : roomSession.status === "full"
      ? "This shared map is full. Try again later."
      : roomSession.status === "limited"
      ? "Too many shared maps were opened from your network. Try again in an hour."
      : roomSession.status === "no-space"
      ? "The server has no space for shared maps. Tell the person who runs it."
      : null);

  useBrowserTabTitle();

  // The storage HTTP client for Share and My maps, built on first use.
  const shareClientRef = useRef<HttpStorageClient | null>(null);
  function getShareClient(): HttpStorageClient {
    if (!shareClientRef.current) {
      const cfg = getAppConfig();
      shareClientRef.current = createHttpStorageClient({
        baseUrl: cfg.storageBaseUrl ?? "",
      });
    }
    return shareClientRef.current;
  }
  // Root container ref — used by useMapWheelRouter to intercept wheel events
  // in capture phase before they reach the Excalidraw layer (atlasdraw-5afc).
  const rootRef = useRef<HTMLDivElement>(null);
  // Collar shell portal hosts — Excalidraw's toolbar renders flush into the
  // collar tool strip, and the main-menu trigger into the head bar, via the
  // vendored collarToolbarTarget / collarMenuTarget props. State (not refs)
  // so Excalidraw re-renders once the hosts mount.
  const [toolStripHost, setToolStripHost] = useState<HTMLDivElement | null>(
    null,
  );
  const [menuHost, setMenuHost] = useState<HTMLDivElement | null>(null);
  // Phase 6 A14b — aria-live selection-change announcer, read inside
  // useExcalidrawChangeHandler.
  const announceMapEditor = useAnnounce();
  // The map camera drives Excalidraw's viewport; Excalidraw's own viewport
  // changes (space-drag, scroll to content) and zoom actions go to the map.
  const [excalidrawLayer, setExcalidrawLayer] = useState<HTMLDivElement | null>(
    null,
  );
  const { bridge: cameraBridge, onZoomAction } = useCameraBridge(
    map,
    excalidrawAPI,
    excalidrawLayer,
  );

  // Fire onMount exactly once per (map, api) tuple. `onMount` is intentionally
  // excluded from deps so a re-rendered parent passing a fresh closure doesn't
  // retrigger the callback.
  useEffect(() => {
    if (map && excalidrawAPI) {
      onMount?.(map, excalidrawAPI);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, excalidrawAPI]); // onMount excluded: fire-once-per-tuple semantics

  // Selection: store → Excalidraw. Annotation ids in the shared selection
  // store are pushed into the Excalidraw scene. The key-set comparison with
  // the live Excalidraw selection makes this a no-op for a change that came
  // from the canvas, which breaks the loop with the onChange mirror in
  // useExcalidrawChangeHandler. A selection never moves the camera; only
  // "Zoom to layer" does.
  useEffect(() => {
    const unsub = session.view.subscribe((state, prev) => {
      if (!excalidrawAPI || state.selection === prev.selection) {
        return;
      }
      // Data and raster ids are not Excalidraw element ids.
      const annotationIds: Record<string, true> = {};
      for (const id of Object.keys(state.selection)) {
        if (!isOverlayId(id)) {
          annotationIds[id] = true;
        }
      }
      const currentIds = excalidrawAPI.getAppState()?.selectedElementIds ?? {};
      const currentKeys = Object.keys(currentIds).sort().join(",");
      const nextKeys = Object.keys(annotationIds).sort().join(",");
      if (currentKeys !== nextKeys) {
        excalidrawAPI.updateScene({
          appState: { selectedElementIds: annotationIds },
        });
      }
    });
    return unsub;
  }, [session, excalidrawAPI]);

  // Map-click → panel selection for data/raster layers, and the attribute
  // popup for the feature under the pointer. The hand tool lets the click
  // through to MapLibre; with the selection tool Excalidraw takes the press,
  // and a click on empty canvas reaches the same handler
  // (useCanvasClickThrough).
  const featurePopup = useFeaturePopup(map as unknown as PopupMap | null);
  const { show: showFeaturePopup, close: closeFeaturePopup } = featurePopup;
  const handleMapClick = useCallback(
    (point: maplibregl.Point, lngLat: maplibregl.LngLat) => {
      if (!map) {
        return;
      }
      const overlays = currentDocument().snapshot().overlays;

      // The topmost visible data layer under the pointer wins (featureAt).
      const hit = featureAt(map, overlays, point);
      if (hit) {
        session.view.getState().select(hit.overlayId);
        showFeaturePopup(hit, lngLat);
        return;
      }
      closeFeaturePopup();

      // Rasters draw no features: test the point against the projected
      // corners, top raster first, visible ones only.
      const rasters = overlays
        .filter((e): e is RasterLayerEntry => e.kind === "raster" && e.visible)
        .sort((a, b) => b.order - a.order);
      for (const r of rasters) {
        const screenCorners = r.corners.map((c) => map.project(c));
        if (pointInPolygon(point, screenCorners)) {
          session.view.getState().select(r.id);
          return;
        }
      }

      // Click on empty area → clear selection
      session.view.getState().clearSelection();
    },
    [session, map, showFeaturePopup, closeFeaturePopup],
  );
  useEffect(() => {
    if (!map) {
      return;
    }
    const handler = (e: maplibregl.MapMouseEvent) => {
      // Only handle when not in a drawing tool
      const activeTool = excalidrawAPI?.getAppState()?.activeTool?.type;
      if (activeTool && activeTool !== "selection" && activeTool !== "hand") {
        return;
      }
      handleMapClick(e.point, e.lngLat);
    };

    map.on("click", handler);
    return () => {
      map.off("click", handler);
    };
  }, [map, excalidrawAPI, handleMapClick]);
  useCanvasClickThrough(excalidrawAPI, map, handleMapClick);

  // Phase 4 T6/T7 — basemap style application (extracted to useBasemapStyle).
  useBasemapStyle(map, activeBasemapId, getAppConfig().allowRemoteBasemaps);

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
    w.__atlasdraw__ = {
      map,
      excalidrawAPI,
      // Measurement hooks for scripts/bench-world-coords.mjs.
      cameraBridge,
      seed: (n: number) =>
        seedShapes(map, excalidrawAPI, n, currentDocument().snapshot().world),
      frame: () => currentDocument().snapshot().world,
      isDirty: () => usePersistenceStore.getState().isDirty,
      clearDirty: () => usePersistenceStore.getState().clearDirty(),
      toLngLat,
      toScene,
    };
    return () => {
      delete (window as unknown as { __atlasdraw__?: unknown }).__atlasdraw__;
    };
  }, [map, excalidrawAPI, cameraBridge]);

  // Persistence wiring (usePersistenceWiring): creates the PersistenceStore,
  // opens the last autosaved document,
  // starts auto-save, and mirrors dirty/drain state into Zustand.
  usePersistenceWiring(excalidrawAPI, documentNotify, open, session.view);
  // Publish the scene for the layer panel's annotation rows and commands.
  useSceneBinding(excalidrawAPI);

  // Route wheel events to the map regardless of whether Excalidraw's drawing
  // layer is on top. Without this, scroll-to-zoom is silently captured by
  // Excalidraw in any non-hand tool.
  useMapWheelRouter(rootRef.current, map);

  // Draw the open document's overlays on the map. This is the only writer of
  // the overlay part of the style.
  useMapOverlays(map);

  // Derive pointer-events gate from active Excalidraw tool (Flow B decision node).
  // isDrawingMode=true → Excalidraw captures events; false → events pass to MapLibre.
  const { isDrawingMode: toolWantsToDraw } = useToolState(excalidrawAPI);

  // RT-3/RT-9 — how far the camera is turned, as state. The compass draws from
  // it and the drawing gate below decides from it.
  const cameraRot = useCameraRotation(map);

  // RT-9 — drawing is blocked while the camera is turned (D6).
  //
  // Unprojecting the pointer is correct at any rotation, but the *shape* is
  // not: drag a rectangle at 30° and unprojecting its corners yields a
  // north-aligned bbox that is not the box you dragged. Rather than stamp a
  // shape the user did not draw, the plate refuses the drag and the hint below
  // offers the compass's one-click way back.
  //
  // Implemented as the pointer-events gate rather than by disabling toolbar
  // buttons: the toolbar is vendored Excalidraw and the gate is the one place
  // that already decides whether a drag reaches the canvas at all. Blocked, the
  // drag reaches MapLibre instead — so a rotated plate still pans and zooms.
  //
  // Not blocked: the atlas tools (PinTool). A pin is a *point* anchor, which
  // is exact at every rotation — RT-9 is about bbox shape, and blocking a
  // correct tool would be superstition.
  const drawingBlocked = cameraRot.isRotated;
  const isDrawingMode = toolWantsToDraw && !drawingBlocked;

  // Atlas-side tool dispatcher (PinTool & friends). When `activeAtlasTool` is
  // non-null, the interaction overlay below mounts above Excalidraw and
  // captures pointerdown — converting it into a `ToolPointerEvent` that the
  // active tool consumes via its onPointerDown handler.
  const { activeAtlasTool, setActiveAtlasTool, dispatchPointerDown } =
    useAtlasdrawTool(map, excalidrawAPI);
  const isPinActive = activeAtlasTool?.id === "pin";

  // Comment mode: a click on the map starts a thread.
  const commentMode = useStore(session.view, (s) => s.commentMode);
  useCommentModeTool({
    view: session.view,
    atlasTool: activeAtlasTool,
    setAtlasTool: setActiveAtlasTool,
  });
  // Badge count — derived from the open document's comments.
  const comments = useDocumentStore((state) => state.doc.comments);
  const openThreadCount = useOpenThreadCountFor(comments);

  // Canvas search reaches comment text through this prop — the search menu
  // lives in the vendored editor and cannot see the comments Y.Doc otherwise.
  // Memoized inside the hook: <Excalidraw> is React.memo'd on a shallow
  // compare, so an unstable array would re-render the editor constantly.
  const commentSearchSources = useCommentSearchSources({
    commentsLayer: comments,
    map,
    excalidrawAPI,
  });

  // Keyboard shortcuts panel — toggled with `?`.
  const [showShortcuts, setShowShortcuts] = useState(false);
  // Quick-actions palette — Cmd+K / Ctrl+K.
  const [showQuickActions, setShowQuickActions] = useState(false);
  // My maps — the maps saved in this browser.
  const [showMyMaps, setShowMyMaps] = useState(false);
  // Onboarding — shown on first visit only.
  const onboarding = useOnboarding();

  // Keyboard shortcuts (Cmd+K quick actions, Cmd+S/Cmd+O save/open, `?`
  // shortcuts panel, Escape to dismiss) — extracted to useMapEditorKeyboard.
  //
  // Open asks before it replaces unsaved work. The question is a promise the
  // ConfirmDialog below settles; null means no question is open.
  const [replacePrompt, setReplacePrompt] = useState<
    ((yes: boolean) => void) | null
  >(null);
  const confirmReplace = useCallback(
    () =>
      new Promise<boolean>((resolve) => {
        setReplacePrompt(() => (yes: boolean) => {
          setReplacePrompt(null);
          resolve(yes);
        });
      }),
    [],
  );
  useMapEditorKeyboard({
    view: session.view,
    excalidrawAPI,
    showShortcuts,
    setShowShortcuts,
    setShowQuickActions,
    onSave: () => void saveMap(session, documentNotify),
    onOpen: () => void openMap(session, documentNotify, confirmReplace),
    onZoomAction,
    drawingLayer: excalidrawLayer,
  });

  // T9 — subscribe to the persistence dirty flag for the MainMenu indicator.
  // Selector form so the component re-renders ONLY on isDirty flips, not on
  // store/dispose pointer changes.
  const isDirty = usePersistenceStore((s) => s.isDirty);
  const serverBackup = useServerBackup(excalidrawAPI, documentNotify);

  // T13 — data-file drag-and-drop import (extracted to useDataFileImport
  // hook). ISSUES.md Direction 1: also exposes importFile() for the
  // deliberate "Import…" menu action below (native file picker), so both
  // trigger paths funnel through the same parse+dispatch pipeline.
  // Imports and conversions add layers to the open document.
  const addDataLayer = useCallback(
    (
      layer: Omit<Extract<DocumentCommand, { type: "add-data-layer" }>, "type">,
    ) => dispatch({ type: "add-data-layer", ...layer }),
    [],
  );
  const addRasterLayer = useCallback(
    (
      layer: Omit<
        Extract<DocumentCommand, { type: "add-raster-layer" }>,
        "type"
      >,
    ) => dispatch({ type: "add-raster-layer", ...layer }),
    [],
  );
  // Design doc §5 — the panel defaults closed (Priya's four-minute map never
  // opens it) but a successful import is the one moment both personas want it:
  // it is the "what did I just get?" beat, and where provenance lives. Once per
  // session only, and only if the user hasn't already expressed a preference by
  // opening or closing it — after that their choice wins, which is the whole
  // point of the resolution.
  const autoOpenedRef = useRef(false);
  const userTouchedPanelRef = useRef(false);
  useEffect(() => {
    if (sheetPanelLayout.open) {
      userTouchedPanelRef.current = true;
    }
  }, [sheetPanelLayout.open]);
  const openSheetPanelForImport = useCallback(() => {
    if (autoOpenedRef.current || userTouchedPanelRef.current) {
      return;
    }
    autoOpenedRef.current = true;
    excalidrawAPI?.toggleSidebar({
      name: DEFAULT_SIDEBAR.name,
      // Same literal the tab is registered under below and the MainMenu item
      // opens; there is no shared constant for it yet and inventing one here
      // would be a rename across three call sites, not this step's work.
      tab: "layers",
      force: true,
    });
  }, [excalidrawAPI]);
  const { importFile } = useDataFileImport(
    rootRef,
    addDataLayer,
    openSheetPanelForImport,
    addRasterLayer,
  );

  // ISSUES.md Direction 1 — "Import…" menu action. Mirrors the hidden-
  // <input type="file"> pattern in state/persistence.ts's fallbackOpen:
  // create it off-DOM, click it programmatically, clean up once settled.
  // .accept covers every format useDataFileImport understands, so one
  // picker serves GeoJSON, CSV, Shapefile, KML, KMZ, GPX and GeoTIFF. It is
  // the menu-driven equivalent of a drop.
  const handleImportFile = useCallback(() => {
    if (typeof document === "undefined") {
      return;
    }
    const input = document.createElement("input");
    input.type = "file";
    // FU-1: .tif/.tiff/.geotiff added with the raster importer. A format
    // missing here is invisible in the picker even though a drop would work.
    input.accept =
      ".geojson,.json,.csv,.zip,.kml,.kmz,.gpx,.tif,.tiff,.geotiff";
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

  // W-C — Convert annotation → data layer, via the element right-click
  // context menu (registered internally). Extracted to useConvertToDataLayer
  // hook; its returned currentConvertibleSelection/handleConvert pair has no
  // consumer here today (no MainMenu item wires it — see the hook's header).
  useConvertToDataLayer(excalidrawAPI, addDataLayer, toast);

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
      icon: <LayersIcon />,
      content: <LayerPanel />,
    });
  }, [excalidrawAPI]);

  // Step 5 — the "comments" sidebar tab is GONE. Comments are a mode now (rail
  // toggle + `C`), and the chronological list survives one level down, as the
  // Threads section of the Layers tab's Sheet scope (LayerPanel). Nothing
  // calls registerSidebarTab({name: "comments"}) any more; the rail is driven
  // off getSidebarTabs(), so the entry disappears from it automatically.
  // Rationale + precedent: PLANS/ATLASDRAW_SIDEBAR_DESIGN.md §3.

  // W-B — Composite PNG export (extracted to useExportPNG hook).
  const handleExportPNG = useExportPNG(map, excalidrawAPI, mapBg, toast);

  // Export callbacks for ExportDialog — wraps existing handlers.
  const handleExportGeoJSON = useCallback(
    (opts: GeoJsonExportOptions) => {
      if (!excalidrawAPI) {
        return;
      }
      const fc = drawingToFeatureCollection(
        excalidrawAPI.getSceneElements(),
        currentDocument().snapshot().world,
      );
      // Data layers join the drawn shapes here, never inside the drawn-shape
      // converter.
      const file = geoJsonExportFile(fc, currentDocument().snapshot(), opts);
      downloadBlob(new Blob([file.text], { type: file.type }), file.fileName);
    },
    [excalidrawAPI],
  );

  const handleExportAtlasdraw = useCallback(() => {
    // Same single door as the MainMenu "Save" item and Cmd+S — the
    // .atlasdraw card is just another entry point to it.
    void saveMap(session, documentNotify);
  }, [session, documentNotify]);

  // Excalidraw onChange: background intercept + autosave markDirty +
  // aria-live selection announce — extracted to useExcalidrawChangeHandler.
  const handleExcalidrawChange = useExcalidrawChangeHandler({
    view: session.view,
    excalidrawAPI,
    announceMapEditor,
    setMapBg,
  });

  // The PDF export's image source: the SAME composite the PNG export uses, so
  // the two formats cannot disagree about what an export contains. Passing
  // `map.getCanvas()` here is what dropped every drawn shape from the PDF
  // (FU-12) — MapLibre's canvas has no Excalidraw content on it. The dialog
  // picks `pixelRatio` so the image is print resolution for the page.
  const getMapImageDataUrl = useCallback(
    async (pixelRatio: number): Promise<string | null> => {
      if (!map || !excalidrawAPI) {
        return null;
      }
      return exportCompositeDataURL(map, excalidrawAPI, {
        pixelRatio,
        backgroundColor: mapBg,
      });
    },
    [map, excalidrawAPI, mapBg],
  );

  // The view's size and ground resolution: the PNG sizes and the PDF scale bar.
  const getExportView = useCallback(
    () => (map ? measureView(map) : null),
    [map],
  );

  // RT-4. How far the camera is turned, for the PDF's north arrow: the
  // screen angle of geographic east, the same angle the drawing layer is
  // turned by (useCameraRotation). Read at export time, like the image and
  // the legend, so all three answer the same viewport.
  const getCameraRotationDeg = useCallback(
    (): number => (map ? -map.getBearing() : 0),
    [map],
  );

  // The legend describes the exported page, not the document (FU-13): hidden
  // layers and layers with nothing painted in this view are left out. Read at
  // export time, like the image, so both answer the same viewport.
  const getLegendEntries = useCallback((): LayerLegendEntry[] => {
    if (!map || !excalidrawAPI) {
      return [];
    }
    // Annotations first: the panel lists them above the data layers.
    return exportLegendEntries(
      [
        ...annotationRows(
          excalidrawAPI.getSceneElements(),
          currentDocument().snapshot().world,
        ),
        ...currentDocument().snapshot().overlays,
      ],
      map,
      excalidrawAPI,
    );
  }, [map, excalidrawAPI]);

  return (
    <SessionProvider session={session}>
      {/* Collar shell (variant A) — the printed map-sheet frame. The plate
        (children) hosts the MapLibre + Excalidraw stack; head bar carries
        the wordmark, sheet name and geo-search; marginalia grows out of
        StatusBar in the foot row. */}
      <CollarShell
        map={map}
        sheetName={<SheetNameField />}
        headExtras={<GeoSearchControl map={map} variant="collar" />}
        toolStripHostRef={setToolStripHost}
        menuHostRef={setMenuHost}
        tabs={<SheetRail excalidrawAPI={excalidrawAPI} />}
        panelInset={platePanelInset}
        foot={
          <StatusBar
            map={map}
            dirty={isDirty}
            attribution={getBasemap(activeBasemapId)?.attribution}
          />
        }
      >
        <div
          ref={rootRef}
          className={[styles.root, commentMode ? styles.commentMode : ""]
            .filter(Boolean)
            .join(" ")}
          style={{ backgroundColor: mapBg }}
          data-testid="map-editor-root"
          data-comment-mode={commentMode ? "on" : undefined}
          // RT-9's gate, in observable form. The gate itself is a
          // pointer-events class on a nested div; this attribute is the state
          // that produced it, which is what a test or an e2e can assert
          // without depending on CSS-module class naming.
          data-drawing-blocked={drawingBlocked ? "true" : undefined}
        >
          {/* Bottom layer: MapLibre GL map */}
          <div className={styles.mapLayer}>
            <MapCanvas
              initialView={initialView}
              onMapReady={onMapReady}
              className={styles.fullSize}
              // Attribution is printed in the Collar marginalia (StatusBar)
              // — no floating control over the plate.
              hideAttribution
              // RT-3 — the editor is the one view that ships a compass, so it
              // is the one view allowed to rotate. Two-finger twist and
              // shift+arrows; right-drag stays with Excalidraw's context menu.
              allowRotation
            />
          </div>

          {/* Top layer: Excalidraw canvas, transparent background.
          pointer-events: none (from .excalidrawLayer) — toggled to auto via
          .excalidrawLayerActive when isDrawingMode is true (Flow B gate). */}
          <div
            ref={setExcalidrawLayer}
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
              onScrollChange={cameraBridge?.onScrollChange}
              onZoomAction={onZoomAction}
              screenSizedStyles
              UIOptions={EXCALIDRAW_UI_OPTIONS}
              // Collar mode: toolbar + main menu render flush in the collar
              // frame (portal hosts provided by CollarShell above). Geo-search
              // lives in the head bar; the Pin tool and the comment-mode
              // toggle ride the toolbar-extras slot so they sit with the
              // drawing tools, per the prototype.
              collarToolbarTarget={toolStripHost}
              collarMenuTarget={menuHost}
              searchSources={commentSearchSources}
              // SheetRail (collar right column) is the sidebar's only trigger
              // surface — suppress the sidebar's own tab-trigger row so there
              // is exactly one rail. Two rails is what let the hardcoded one
              // drift, and four labelled triggers in a 294px header clipped.
              hideDefaultSidebarTabTriggers
              // Sheet-panel width: ours to own (SheetPanelResizer edits it,
              // state/sheetPanel.ts persists it), the editor's to publish as
              // --right-sidebar-width and clamp. `onSidebarLayoutChange` is the
              // return path that tells us when to reflow the plate.
              rightSidebarWidth={sheetPanelWidth}
              onSidebarLayoutChange={onSidebarLayoutChange}
              renderToolbarExtras={() => (
                <>
                  <PinToolButton
                    active={isPinActive}
                    onToggle={() =>
                      setActiveAtlasTool(isPinActive ? null : PinTool)
                    }
                  />
                  <MeasureToolButton />
                  <CommentModeButton
                    active={commentMode}
                    onToggle={session.view.getState().toggleCommentMode}
                    openThreadCount={openThreadCount}
                  />
                </>
              )}
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
                    void openMap(session, documentNotify, confirmReplace)
                  }
                  data-testid="main-menu-open"
                >
                  Open…
                </MainMenu.Item>
                <MainMenu.Item
                  onSelect={() => void saveMap(session, documentNotify)}
                  data-testid="main-menu-save"
                >
                  Save
                </MainMenu.Item>
                <MainMenu.Item
                  onSelect={() => setShowMyMaps(true)}
                  data-testid="main-menu-my-maps"
                >
                  My maps…
                </MainMenu.Item>
                {serverBackup.available && (
                  <MainMenu.Item
                    onSelect={serverBackup.request}
                    data-testid="main-menu-restore-backup"
                  >
                    Restore from server backup
                  </MainMenu.Item>
                )}
                <MainMenu.Item
                  onSelect={handleImportFile}
                  data-testid="main-menu-import"
                >
                  Import…
                </MainMenu.Item>
                <MainMenu.Item
                  onSelect={() => setExportDialogFormat("png")}
                  data-testid="main-menu-export"
                >
                  Export…
                </MainMenu.Item>
                {/* Phase 4 T8 — Share link. Root-level mounted (same pattern as
                AboutDialog) so MainMenu auto-close doesn't unmount the
                dialog before the link is copied. */}
                <MainMenu.Item
                  onSelect={() => setShowShareDialog(true)}
                  data-testid="main-menu-share"
                >
                  Share map
                </MainMenu.Item>
                <MainMenu.Separator />
                <MainMenu.DefaultItems.ClearCanvas />
                <MainMenu.Separator />
                <MainMenu.Item
                  onSelect={() => setShowSettings(true)}
                  data-testid="main-menu-settings"
                >
                  Settings…
                </MainMenu.Item>
                {/* Atlasdraw's own help, not MainMenu.DefaultItems.Help:
                Excalidraw's HelpDialog lists upstream keys and links. `?`
                opens this one too (EXCALIDRAW_UI_OPTIONS.toggleShortcuts). */}
                <MainMenu.Item
                  onSelect={() => setShowShortcuts(true)}
                  data-testid="main-menu-shortcuts"
                >
                  Keyboard shortcuts
                </MainMenu.Item>
                <MainMenu.Item
                  onSelect={() => setShowAboutDialog(true)}
                  data-testid="main-menu-about"
                >
                  About Atlasdraw
                </MainMenu.Item>
                <MainMenu.DefaultItems.ToggleTheme />
                {/* IA restructure — the menu holds document + app scope only:
                document ops above the first separator, canvas reset, then
                app-level entries. Ejected to their objects' homes:
                  "Pin to map"        → toolbar (PinToolButton, renderToolbarExtras)
                  "Comment mode"      → toolbar (CommentModeButton, same slot)
                  "● Unsaved"         → StatusBar dirty indicator
                  "Layers panel"      → sidebar trigger + ⌘K palette
                  "Find on canvas"    → ⌘F + sidebar Search tab + ⌘K palette
                  Basemap/Edit style  → LayerPanel Basemap section
                  "Asset library"     → ⌘K palette */}
              </MainMenu>
            </Excalidraw>
          </div>

          {/* The attributes of the feature the last map click opened. */}
          <FeaturePopup
            popup={featurePopup.popup}
            onClose={featurePopup.close}
          />

          {/* Phase 6 A3 — anchored comment overlay. Iterates the live
          CommentsLayer and renders one bubble per unresolved comment,
          projected to screen coords. Doubles as the pending-anchor picker
          (next map click or single-element selection). z-index 10 (toolbar
          band); the container is pointer-events: none so non-anchor clicks
          pass through. */}
          <CommentAnchorsOverlay map={map} excalidrawAPI={excalidrawAPI} />

          {/* RT-3 — the compass. Always mounted, not just while rotated: it is
          the only mouse gesture that rotates, so hiding it at north-up would
          leave rotation reachable by trackpad and keyboard alone. */}
          <MapCompass map={map} rotation={cameraRot} />

          {/* RT-9 — say why the tool went dead. A drawing tool that silently
          does nothing is the worst version of this block; the hint names the
          cause and points at the control that fixes it. Shown only when a
          drawing tool is actually selected — a rotated map is not itself an
          error state. */}
          {drawingBlocked && toolWantsToDraw && (
            <div
              className={styles.drawBlockedHint}
              role="status"
              data-testid="draw-blocked-hint"
            >
              Drawing is off while the map is turned
              <button
                type="button"
                className={styles.drawBlockedReset}
                onClick={() => map?.resetNorth()}
              >
                Reset north
              </button>
            </div>
          )}

          {/* Step 5 — comment mode's on-plate affordance. A mode with no
          visible state is a trap: the crosshair cursor (.commentMode above)
          says "this click does something different" and this hint says what,
          and how to get out. role="status" so entering the mode is announced
          rather than only drawn. */}
          {commentMode && (
            <div
              className={styles.commentModeHint}
              role="status"
              data-testid="comment-mode-hint"
            >
              Click the map or an element to start a thread
              <span className={styles.commentModeHintKey}>Esc</span>
              to exit
            </div>
          )}

          {/* Who else is in the room, and where their pointers are. */}
          {roomSession.room && (
            <>
              <CursorOverlay map={map} peers={roomSession.peers} />
              <PresenceList
                peers={roomSession.peers}
                self={roomSession.self}
                onRename={roomSession.rename}
                onGoTo={(camera) =>
                  map?.jumpTo({
                    center: camera.center,
                    zoom: camera.zoom,
                    bearing: camera.bearing,
                    pitch: camera.pitch,
                  })
                }
              />
            </>
          )}

          {/* Sheet-panel resize handle, at the panel's left edge. Mounted only
          while the panel is open — its whole position is "the panel's edge",
          which does not exist otherwise. Rendered for the floating (undocked)
          panel too: the edge is in the same place either way, only the plate's
          reflow depends on docking.

          Also gated on `collar`, because the handle's `right: width` is only
          the panel's edge under the collar treatment. On a phone the editor
          drops collar mode, the sidebar falls back to upstream's
          `width - space-factor * 2` (286 of a 302px property), and the handle
          becomes a 16px col-resize strip floating over the map — a hit target
          for a drag that cannot mean anything. A phone has no pointer to hover
          it with either. */}
          {sheetPanelLayout.open && sheetPanelLayout.collar && (
            <SheetPanelResizer
              width={sheetPanelWidth}
              onWidth={setSheetPanelWidth}
              onReset={resetSheetPanelWidth}
            />
          )}

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
              <ToolOptionsBar label={activeAtlasTool.label} showEscapeHint />
            </>
          )}

          {/* W9 — the Measure tool's overlay and the selection readout. */}
          <MeasureLayer
            map={map}
            excalidrawAPI={excalidrawAPI}
            otherToolActive={activeAtlasTool !== null || commentMode}
            onStart={() => setActiveAtlasTool(null)}
          />

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

          {/* Phase 4 T14 — AboutDialog. Same root-level pattern as the basemap
          picker so MainMenu auto-close doesn't unmount it. */}
          {showAboutDialog && (
            <Suspense fallback={null}>
              <AboutDialog onCloseRequest={() => setShowAboutDialog(false)} />
            </Suspense>
          )}

          {/* Settings — tabbed modal replacing standalone BasemapPickerDialog. */}
          {showSettings && (
            <Suspense fallback={null}>
              <SettingsDialog onCloseRequest={() => setShowSettings(false)} />
            </Suspense>
          )}

          {/* Export — unified export surface (PNG / PDF / GeoJSON / .atlasdraw).
          The PDF pane needs the live MapLibre canvas (at export time, so the
          PDF reflects the current viewport) and the layers projected to legend
          shape: annotations have no color of their own → use a neutral grey;
          data layers carry style.fillColor. */}
          {exportDialogFormat && (
            <Suspense fallback={null}>
              <ExportDialog
                initialFormat={exportDialogFormat}
                onCloseRequest={() => setExportDialogFormat(null)}
                onExportPNG={handleExportPNG}
                onExportGeoJSON={handleExportGeoJSON}
                onExportAtlasdraw={handleExportAtlasdraw}
                getView={getExportView}
                getMapImageDataUrl={getMapImageDataUrl}
                getCameraRotationDeg={getCameraRotationDeg}
                getLegendEntries={getLegendEntries}
                attribution={getBasemap(activeBasemapId)?.attribution}
              />
            </Suspense>
          )}

          {replacePrompt && (
            <ConfirmDialog
              title="Open another map?"
              body="This map has changes you have not saved to a file. Opening another map closes it."
              confirmLabel="Open anyway"
              onConfirm={() => replacePrompt(true)}
              onCancel={() => replacePrompt(false)}
            />
          )}

          {showMyMaps && excalidrawAPI && (
            <MyMapsDialog
              excalidrawAPI={excalidrawAPI}
              map={map}
              notify={documentNotify}
              onClose={() => setShowMyMaps(false)}
              server={
                getAppConfig().enableBackendPersistence
                  ? getShareClient()
                  : null
              }
            />
          )}
          {serverBackup.dialog}

          {/* ShareDialog. Mounted only when excalidrawAPI is ready (the share
          reads the drawing). Collaborate makes a room from this map, or
          shows the link of the room the editor is in. */}
          {showShareDialog && excalidrawAPI && (
            <ShareDialog
              onCloseRequest={() => setShowShareDialog(false)}
              getDoc={() =>
                toFile(currentDocument(), undefined, liveCamera(map))
              }
              client={getShareClient()}
              startRoom={roomSession.available ? roomSession.start : null}
            />
          )}

          {/* Why a room link cannot be joined, without blocking the editor. */}
          {roomProblem && (
            <div
              data-testid="collab-room-error"
              role="alert"
              className={styles.collabRoomError}
            >
              {roomProblem}
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
                  keywords: ["marker", "point"],
                  onSelect: () => setActiveAtlasTool(PinTool),
                },
                {
                  id: "measure",
                  label: "Measure distance",
                  category: "Tools",
                  hint: "M",
                  keywords: ["ruler", "length", "area", "distance"],
                  onSelect: () => session.view.getState().setMeasuring(true),
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
                  // Step 5 — was "Comments panel" → toggleSidebar({tab:
                  // "comments"}), a tab that no longer exists. The palette
                  // entry now enters the mode; the list view is reachable as
                  // the Threads section of the Layers tab.
                  id: "comments",
                  label: commentMode ? "Exit comment mode" : "Comment mode",
                  category: "View",
                  hint: "C",
                  keywords: ["comment", "threads", "annotate", "review"],
                  onSelect: session.view.getState().toggleCommentMode,
                },
                {
                  id: "find",
                  label: "Find on canvas",
                  category: "View",
                  hint: "⌘F",
                  keywords: ["search", "text", "sidebar"],
                  onSelect: () =>
                    excalidrawAPI?.toggleSidebar({
                      name: DEFAULT_SIDEBAR.name,
                      tab: CANVAS_SEARCH_TAB,
                    }),
                },
                {
                  id: "asset-library",
                  label: "Asset library",
                  category: "View",
                  keywords: ["stamps", "fixtures", "wildfire", "transit"],
                  onSelect: () => setShowAssetLibrary(true),
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
                  onSelect: () => setExportDialogFormat("pdf"),
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
                    void openMap(session, documentNotify, confirmReplace),
                },
                {
                  id: "save",
                  label: "Save map",
                  category: "File",
                  hint: "⌘S",
                  keywords: ["disk", "file", "atlasdraw"],
                  onSelect: () => void saveMap(session, documentNotify),
                },
                {
                  id: "my-maps",
                  label: "My maps",
                  category: "File",
                  keywords: ["list", "recent", "new", "delete", "documents"],
                  onSelect: () => setShowMyMaps(true),
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
                  keywords: ["style", "tiles", "background", "layers"],
                  // Basemap lives in the Layers panel now (bottom of the stack).
                  onSelect: () =>
                    excalidrawAPI?.toggleSidebar({
                      name: DEFAULT_SIDEBAR.name,
                      tab: "layers",
                    }),
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
    </SessionProvider>
  );
}
