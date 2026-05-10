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

import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { MapCanvas } from "@atlasdraw/basemap";
import type { MapCanvasInitialView } from "@atlasdraw/basemap";
import {
  compileLayer,
  defaultLayerStyle,
  BASEMAPS,
  resolveStyle,
  registerPmtilesProtocol,
  BasemapRemoteGatedError,
} from "@atlasdraw/basemap";
import type { BasemapConfig } from "@atlasdraw/basemap";
import {
  parse,
  GeoJSONParseError,
  requireHomogeneousGeometry,
} from "@atlasdraw/data";
import { Excalidraw, MainMenu, setExportElementTransformer } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw";
import { DEFAULT_SIDEBAR } from "@excalidraw/common";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import type maplibregl from "maplibre-gl";
import {
  PinTool,
  annotationToFeatureCollection,
  UnsupportedConvertElementError,
  type ConvertibleElement,
} from "@atlasdraw/tools";
import { isGeoCustomData, normalizeElementsForExport } from "@atlasdraw/geo";
import type { GeoAnchor } from "@atlasdraw/geo";
import { useMapRef } from "../hooks/useMapRef";
import { useCoordinateSync } from "../hooks/useCoordinateSync";
import { useGeoAnchor } from "../hooks/useGeoAnchor";
import { useLayerRegistrySync } from "../hooks/useLayerRegistrySync";
import { useToolState } from "../hooks/useToolState";
import { useAtlasdrawTool } from "../hooks/useAtlasdrawTool";
import { useMapWheelRouter } from "../hooks/useMapWheelRouter";
import { useLayerRegistry } from "../hooks/useLayerRegistry";
import { LayerPanel } from "./LayerPanel";
import { BasemapPickerDialog } from "./BasemapPickerDialog";
import { exportPNG } from "../lib/export";
import { createPersistenceStore } from "../state/persistence";
import { usePersistenceStore } from "../state/usePersistenceStore";
import { useLayerRegistryStore } from "../state/layerRegistry";
import { selectDocument } from "../state/selectDocument";
import { startAutoSave } from "../state/persistence";
import { hydrate } from "../state/hydrate";
import styles from "../styles/MapEditor.module.css";

/**
 * Pick a MapLibre layer kind for the FeatureCollection's first feature.
 * Wave 2b stays simple: one geometry kind per dropped file. Mixed-geometry
 * collections (Phase 5) will need split-by-type rendering. Points fall back
 * to "circle"; unknown/empty falls back to "circle" too (renders nothing
 * harmlessly).
 */
function inferGeometryType(fc: FeatureCollection): "fill" | "line" | "circle" {
  const t = fc.features[0]?.geometry?.type;
  if (t === "Polygon" || t === "MultiPolygon") return "fill";
  if (t === "LineString" || t === "MultiLineString") return "line";
  return "circle";
}

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
    if (typeof el !== "object" || el === null) continue;
    const cd = (el as { customData?: unknown }).customData;
    if (!isGeoCustomData(cd)) continue;
    features.push({ type: "Feature", geometry: geoAnchorToGeometry(cd.geo), properties: {} });
  }
  return { type: "FeatureCollection", features };
}

// ---------------------------------------------------------------------------
// Atlasdraw export cards (atlasdraw-9078, Phase 4 Wave 0 prereq)
//
// Unify atlasdraw-format Save/Open and GeoJSON export INTO Excalidraw's
// existing JSONExportDialog (the Card grid opened by MainMenu.DefaultItems
// .Export → openDialog: { name: "jsonExport" }) via the public extension
// point `UIOptions.canvasActions.export.renderCustomUI`. Replaces the
// adjacent <MainMenu.Item> "Save .atlasdraw…" / "Open .atlasdraw…" entries
// that Phase 3 T9 added — single entry point ("Export") now reaches
// every atlas-format I/O surface alongside Excalidraw's own .excalidraw
// disk save (saveFileToDisk). Excalidraw's .excalidraw-format Load (the
// LoadScene MainMenu item) still lives in the menu — no dialog equivalent
// upstream — so we keep <MainMenu.DefaultItems.LoadScene /> there.
//
// Why renderCustomUI rather than a parallel dialog: it IS the same place
// the user already opens. A parallel `<AtlasdrawExportDialog>` would
// reintroduce the dual-entry-points ergonomic bug 9078 closes. Bonus —
// no vendored-fork patch, no separate open/close state, no juggling of
// `useExcalidrawContainer` context (Dialog needs it; renderCustomUI is
// already inside the Excalidraw provider tree).
// ---------------------------------------------------------------------------

function renderGeoJsonCard(elements: readonly unknown[]): React.JSX.Element {
  const fc = buildGeoJsonExport(elements);
  const count = fc.features.length;
  const empty = count === 0;
  return (
    <div
      className="Card"
      style={
        {
          "--card-color": "var(--color-primary)",
          "--card-color-darker": "var(--color-primary-darker)",
          "--card-color-darkest": "var(--color-primary-darkest)",
        } as React.CSSProperties
      }
    >
      <h2>GeoJSON</h2>
      <div className="Card-details">
        {empty
          ? "No geo-anchored annotations in scene"
          : `${count} geo-anchored annotation${count !== 1 ? "s" : ""}`}
      </div>
      <button
        className="Card-button"
        type="button"
        disabled={empty}
        aria-disabled={empty}
        title={empty ? "No geo-anchored annotations to export" : undefined}
        data-testid="geojson-export-download"
        onClick={() => {
          const blob = new Blob([JSON.stringify(fc, null, 2)], {
            type: "application/geo+json",
          });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = "annotations.geojson";
          a.click();
          URL.revokeObjectURL(url);
        }}
      >
        Download .geojson
      </button>
    </div>
  );
}

function renderAtlasdrawSaveCard(
  excalidrawAPI: ExcalidrawImperativeAPI,
): React.JSX.Element {
  return (
    <div
      className="Card"
      style={
        {
          "--card-color": "#74b816", // open-color lime[7] (matches disk save)
          "--card-color-darker": "#66a80f",
          "--card-color-darkest": "#5c940d",
        } as React.CSSProperties
      }
    >
      <h2>Atlasdraw</h2>
      <div className="Card-details">
        Save scene + map layers + geo data as a portable .atlasdraw file.
      </div>
      <button
        className="Card-button"
        type="button"
        data-testid="atlasdraw-export-save"
        aria-label="Save .atlasdraw"
        onClick={async () => {
          const store = usePersistenceStore.getState().persistenceStore;
          if (!store) return;
          try {
            await store.saveToDisk(
              selectDocument(excalidrawAPI, useLayerRegistryStore.getState()),
            );
            usePersistenceStore.getState().clearDirty();
          } catch (err) {
            // eslint-disable-next-line no-console
            console.warn("[atlasdraw] saveToDisk failed", err);
          }
        }}
      >
        Save .atlasdraw
      </button>
    </div>
  );
}

function renderAtlasdrawOpenCard(
  excalidrawAPI: ExcalidrawImperativeAPI,
): React.JSX.Element {
  return (
    <div
      className="Card"
      style={
        {
          "--card-color": "#1098ad", // open-color cyan[7] — distinct from save+geojson
          "--card-color-darker": "#0c8599",
          "--card-color-darkest": "#0b7285",
        } as React.CSSProperties
      }
    >
      <h2>Open .atlasdraw</h2>
      <div className="Card-details">
        Load a previously saved .atlasdraw file, replacing the current scene.
      </div>
      <button
        className="Card-button"
        type="button"
        data-testid="atlasdraw-export-open"
        aria-label="Open .atlasdraw"
        onClick={async () => {
          const store = usePersistenceStore.getState().persistenceStore;
          if (!store) return;
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
            }
          } catch (err) {
            // eslint-disable-next-line no-console
            console.warn("[atlasdraw] openFromDisk failed", err);
          }
        }}
      >
        Open .atlasdraw
      </button>
    </div>
  );
}

/**
 * Build the atlasdraw cards that are appended to Excalidraw's JSONExportDialog
 * via `renderCustomUI`. Order: Save → Open → GeoJSON. Save sits leftmost so
 * the lime-coded "save" cluster (Excalidraw's own `Save to disk` lime card +
 * our `.atlasdraw` lime card) reads as a group.
 *
 * Exported for unit tests only — production callers use `buildExportOpts`.
 */
export function renderAtlasdrawExportCards(
  elements: readonly unknown[],
  excalidrawAPI: ExcalidrawImperativeAPI,
): React.JSX.Element {
  return (
    <>
      {renderAtlasdrawSaveCard(excalidrawAPI)}
      {renderAtlasdrawOpenCard(excalidrawAPI)}
      {renderGeoJsonCard(elements)}
    </>
  );
}

/**
 * Build the `UIOptions.canvasActions.export` shape passed to <Excalidraw>.
 * Memoized on `excalidrawAPI` identity so the renderCustomUI closure captures
 * a fresh API after remount but stays stable across normal re-renders —
 * Excalidraw shallow-checks `saveFileToDisk` only, so a stable parent object
 * isn't strictly required, but stable identity is cheap insurance against
 * future Excalidraw memo bugs (per the comment that lived on the old
 * EXCALIDRAW_EXPORT_OPTS module-scoped const).
 */
function buildExportOpts(excalidrawAPI: ExcalidrawImperativeAPI | null) {
  return {
    saveFileToDisk: true,
    renderCustomUI: (elements: readonly unknown[]) =>
      excalidrawAPI ? (
        renderAtlasdrawExportCards(elements, excalidrawAPI)
      ) : (
        renderGeoJsonCard(elements)
      ),
  };
}

// Module-scoped so the Excalidraw mount sees a stable identity. Excalidraw
// reads initialData once on mount; passing a fresh literal each render is
// harmless today but brittle if a future Excalidraw version memoizes on it.
const EXCALIDRAW_INITIAL_DATA = {
  appState: { viewBackgroundColor: "transparent" },
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
  // Root container ref — used by useMapWheelRouter to intercept wheel events
  // in capture phase before they reach the Excalidraw layer (atlasdraw-5afc).
  const rootRef = useRef<HTMLDivElement>(null);
  // Tracks the prior elements array reference so handleExcalidrawChange can
  // skip markDirty when Excalidraw fires onChange without an actual element
  // mutation (initial mount, viewport-only updates, scroll-lock self-fires).
  // Closes atlasdraw-12f0 — the "● Unsaved" indicator no longer trips on
  // first load before the user has done anything.
  const prevElementsRef = useRef<readonly unknown[] | null>(null);
  // Guards against re-entrant updateScene calls in handleExcalidrawChange.
  // CoordinateSync fires many onChange events before React can process our
  // viewBackgroundColor reset; without this flag each one queues another
  // updateScene, exhausting React's 50-update nesting limit.
  const bgResetQueuedRef = useRef(false);

  // Fire onMount exactly once per (map, api) tuple. `onMount` is intentionally
  // excluded from deps so a re-rendered parent passing a fresh closure doesn't
  // retrigger the callback.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (map && excalidrawAPI) {
      onMount?.(map, excalidrawAPI);
    }
  }, [map, excalidrawAPI]); // onMount excluded: fire-once-per-tuple semantics

  // Phase 4 T6/T7 — apply basemap style when the map is ready or the user
  // switches basemaps. registerPmtilesProtocol is idempotent; safe to call
  // before every setStyle that references pmtiles:// URLs. resolveStyle
  // (T7) owns env-var-backed pmtiles path resolution and the remote-tile
  // gate; we just pass the active id and the current allow-remote flag.
  useEffect(() => {
    if (!map) return;
    registerPmtilesProtocol();
    const apply = async () => {
      try {
        // TODO(T14/T15): wire allowRemote from app config (Q3 default = false).
        const style = await resolveStyle(activeBasemapId, {
          allowRemote: false,
        });
        map.setStyle(style);
      } catch (err) {
        if (err instanceof BasemapRemoteGatedError) {
          console.warn(
            `[basemap] Skipping '${err.basemapId}': remote tiles disabled`,
          );
          return;
        }
        throw err;
      }
    };
    void apply();
  }, [map, activeBasemapId]);

  // atlasdraw-9078 — UIOptions.canvasActions.export passed to <Excalidraw>.
  // Memoized on excalidrawAPI identity so the renderCustomUI closure binds
  // a non-null API once available; before that the GeoJSON-only fallback
  // is harmless (Save/Open cards aren't rendered until the API is ready).
  // See `buildExportOpts` above for the wiring rationale.
  const exportOpts = useMemo(() => buildExportOpts(excalidrawAPI), [excalidrawAPI]);

  // Normalize geo-anchored element coords to canonical Web Mercator (zoom 0)
  // before .excalidraw file saves so saved files are viewport-independent.
  useEffect(() => {
    setExportElementTransformer(
      normalizeElementsForExport as Parameters<typeof setExportElementTransformer>[0],
    );
    return () => setExportElementTransformer(null);
  }, []);

  // Dev-only window expose for Playwright E2E. Production builds skip this
  // branch via `import.meta.env.DEV` (Vite replaces it with `false` in prod,
  // making the whole block dead code that gets tree-shaken).
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    if (!map || !excalidrawAPI) return;
    const w = window as unknown as { __atlasdraw__?: unknown };
    w.__atlasdraw__ = { map, excalidrawAPI };
    return () => {
      delete (window as unknown as { __atlasdraw__?: unknown }).__atlasdraw__;
    };
  }, [map, excalidrawAPI]);

  // T9 — Persistence wiring.
  //
  // On excalidrawAPI ready: create a PersistenceStore, attempt to load() the
  // last-persisted document from IDB, start auto-save, and register the dirty
  // channel to React state for the MainMenu indicator.
  //
  // Phase 4 W0 (atlasdraw-3601): scene + layers + FCs are hydrated via
  // `hydrate(loaded, excalidrawAPI)` in state/hydrate.ts. The previously
  // observe-only stub left a refreshed page with a blank canvas even when an
  // IDB doc existed; this closes the round-trip gate.
  useEffect(() => {
    if (!excalidrawAPI) return;
    const store = createPersistenceStore({});
    usePersistenceStore.getState().setPersistenceStore(store);

    let cancelled = false;
    void (async () => {
      try {
        const loaded = await store.load();
        if (cancelled) return;
        if (loaded) {
          await hydrate(loaded, excalidrawAPI);
          // eslint-disable-next-line no-console
          console.info("[atlasdraw] persisted document hydrated", {
            id: loaded.manifest.id,
            layerCount: loaded.manifest.layers.length,
            sceneLength: loaded.scene.length,
          });
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[atlasdraw] persistence.load() failed", err);
      }
    })();

    const unsubDirty = store.onDirty(() => {
      // The underlying store's onDirty fires on its own markDirty(); mirror
      // into Zustand for the MainMenu indicator. Wrapped in setState rather
      // than markDirty() to avoid re-forwarding back into the store.
      usePersistenceStore.setState({ isDirty: true });
    });

    const dispose = startAutoSave(store, () =>
      selectDocument(excalidrawAPI, useLayerRegistryStore.getState()),
    );
    usePersistenceStore.getState().setAutosaveDispose(dispose);

    return () => {
      cancelled = true;
      unsubDirty();
      dispose();
      usePersistenceStore.getState().setAutosaveDispose(null);
      usePersistenceStore.getState().setPersistenceStore(null);
      void store.close();
    };
  }, [excalidrawAPI]);

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

  // T9 — subscribe to the persistence dirty flag for the MainMenu indicator.
  // Selector form so the component re-renders ONLY on isDirty flips, not on
  // store/dispose pointer changes.
  const isDirty = usePersistenceStore((s) => s.isDirty);

  // T13 — GeoJSON drag-and-drop import.
  //
  // Drop must run in CAPTURE phase on the root div — Excalidraw's own
  // handleAppOnDrop (App.tsx:2147) lives on a deeper div and would fire first
  // in the bubble path, calling parseDataTransferEvent which consumes
  // dataTransfer.files before our React-bubble handler ever sees it. For
  // .geojson files we stopPropagation so Excalidraw never sees the event;
  // for other file types we let propagation continue so Excalidraw still
  // handles png/svg/library drops normally.
  const registry = useLayerRegistry();
  const processGeoJsonDrop = useCallback(
    async (file: File) => {
      if (!map) return;
      try {
        // parse() accepts a Blob; File extends Blob, so we pass it directly.
        const fc = await parse(file);
        // T24 (atlasdraw-4142): Atlas v1 supports a single geometry kind per
        // layer. Reject mixed FCs upfront so users see a clear error instead
        // of silently-dropped features. Sub-layers per kind is the
        // planned-of-record direction for Phase 4+.
        requireHomogeneousGeometry(fc);
        const id = `dl:${crypto.randomUUID()}`;
        const style = defaultLayerStyle(fc);
        const geometryType = inferGeometryType(fc);
        // Map mutations first (most likely to throw); registry last.
        map.addSource(id, { type: "geojson", data: fc });
        try {
          map.addLayer(compileLayer(id, style, geometryType));
        } catch (layerErr) {
          // Rollback the orphan source so a retry can reuse the id space.
          try {
            map.removeSource(id);
          } catch {
            /* swallow secondary failure */
          }
          throw layerErr;
        }
        registry.registerDataLayer({ id, fc, label: file.name, style });
      } catch (err) {
        if (err instanceof GeoJSONParseError) {
          // v1 UX — console + alert. Toast/dialog deferred (scrub §3.3).
          // eslint-disable-next-line no-console
          console.error("[MapEditor] GeoJSON parse failed:", err.message);
          window.alert(`GeoJSON parse failed: ${err.message}`);
          return;
        }
        throw err;
      }
    },
    [map, registry],
  );

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onDropCapture = (e: DragEvent) => {
      const file = e.dataTransfer?.files?.[0];
      if (!file || !file.name.endsWith(".geojson")) return;
      // Block Excalidraw's bubble-phase handler from also processing this.
      e.preventDefault();
      e.stopPropagation();
      void processGeoJsonDrop(file);
    };
    const onDragOverCapture = (e: DragEvent) => {
      // preventDefault is needed for drop to fire. Don't stopPropagation —
      // Excalidraw's dragover sets visual cues (cursor) for image drops we
      // still want it to handle.
      e.preventDefault();
    };
    root.addEventListener("drop", onDropCapture, { capture: true });
    root.addEventListener("dragover", onDragOverCapture, { capture: true });
    return () => {
      root.removeEventListener("drop", onDropCapture, { capture: true });
      root.removeEventListener("dragover", onDragOverCapture, { capture: true });
    };
  }, [processGeoJsonDrop]);

  // W-B — Convert annotation → data layer via MainMenu.Item.
  //
  // Rule-0 retrofit: original surface (Wave 3b T14) was a custom <div role="menu">
  // hung off the root container's onContextMenu. v0.18 ships no public way to
  // splice items into Excalidraw's element context menu (App.tsx:12488
  // getContextMenuItems is hardcoded; Action interface has no contextItemLabel).
  // So we surface Convert in the MainMenu hamburger instead — same Rule-0
  // category (existing slot, no fork), with predicate-driven enabled state.
  //
  // `currentConvertibleSelection()` is read at click time (not at render time)
  // so we don't re-render the whole tree on every selection change just to
  // recompute the menu's enabled state.
  //
  // Why we don't call registry.convertAnnotationToDataLayer here: that method
  // mints its own dl:<uuid> internally and uses DEFAULT_CONVERTED_STYLE, but
  // returns nothing — we'd have no id to coordinate with map.addSource/
  // addLayer. Instead we mirror T13's drop pattern: generate the id at the
  // call site, registerDataLayer with the fc/style we built, then remove the
  // annotation entry. Same end state, with id ownership at the call site.
  const currentConvertibleSelection =
    useCallback((): ConvertibleElement | null => {
      if (!excalidrawAPI) return null;
      const appState = excalidrawAPI.getAppState();
      const ids = Object.keys(appState.selectedElementIds ?? {});
      if (ids.length !== 1) return null;
      const el = excalidrawAPI.getSceneElements().find((x) => x.id === ids[0]);
      if (!el || !isGeoCustomData(el.customData)) return null;
      // text elements carry geo but aren't convertible. Filter at the gate
      // so the menu item shows enabled only when the conversion will succeed.
      if (el.type === "text") return null;
      return {
        id: el.id,
        type: el.type,
        customData: el.customData as ConvertibleElement["customData"],
      };
    }, [excalidrawAPI]);

  const handleConvert = useCallback(
    (el: ConvertibleElement) => {
      if (!map || !excalidrawAPI) return;
      try {
        // Step 1 — pure computation, no side effects.
        const fc = annotationToFeatureCollection(el);
        const id = `dl:${crypto.randomUUID()}`;
        const style = defaultLayerStyle(fc);
        const geometryType = inferGeometryType(fc);
        // Step 2 — map mutations first; rollback the orphan source if addLayer throws.
        map.addSource(id, { type: "geojson", data: fc });
        try {
          map.addLayer(compileLayer(id, style, geometryType));
        } catch (layerErr) {
          try {
            map.removeSource(id);
          } catch {
            /* swallow secondary failure */
          }
          throw layerErr;
        }
        // Step 3 — registry mutations (won't throw).
        registry.registerDataLayer({ id, fc, label: el.id, style });
        registry.remove(el.id); // drop the old annotation entry (if any)
        // Step 4 — destructive scene mutation last.
        const remaining = excalidrawAPI
          .getSceneElements()
          .filter((x) => x.id !== el.id);
        excalidrawAPI.updateScene({ elements: remaining });
      } catch (err) {
        if (err instanceof UnsupportedConvertElementError) {
          window.alert(err.message);
          return;
        }
        throw err;
      }
    },
    [map, registry, excalidrawAPI],
  );

  // Register the LayerPanel as a tab inside Excalidraw's DefaultSidebar
  // (the sidebar that hosts Library + canvas Search). Replaces the
  // previous parallel `<Sidebar name="layers">` mount: shares the
  // existing trigger button, dock state, and tab routing instead of
  // requiring a custom MainMenu open-action and a second sidebar
  // surface. The MainMenu "Layers panel" item below addresses this
  // tab via `toggleSidebar({name: DEFAULT_SIDEBAR.name, tab: "layers"})`.
  useEffect(() => {
    if (!excalidrawAPI) return;
    return excalidrawAPI.registerSidebarTab({
      name: "layers",
      label: "Layers",
      content: <LayerPanel />,
    });
  }, [excalidrawAPI]);

  // W-C — Surface Convert as a right-click context-menu item via the
  // atlasdraw fork's `excalidrawAPI.registerContextMenuItem` (added to
  // packages/excalidraw/components/App.tsx). Item appears at the tail
  // of the element menu, gated by the same predicate the W-B MainMenu
  // gate used (single geo selection, not text/arrow). Re-runs on
  // handleConvert identity change; the unregister fn returned by the
  // API removes the prior closure so we don't accumulate stale items.
  useEffect(() => {
    if (!excalidrawAPI) return;
    const unregister = excalidrawAPI.registerContextMenuItem({
      name: "atlasConvertToDataLayer",
      label: "Convert selection to data layer",
      // Same gate as currentConvertibleSelection, but evaluated against the
      // (elements, appState) Excalidraw passes us — independent of the API
      // getters so the menu's enabled state tracks the live selection
      // without us subscribing to onChange.
      predicate: (elements, appState) => {
        const ids = Object.keys(appState.selectedElementIds ?? {});
        if (ids.length !== 1) return false;
        const el = elements.find((x) => x.id === ids[0]);
        if (!el || !isGeoCustomData(el.customData)) return false;
        if (el.type === "text") return false;
        return true;
      },
      perform: () => {
        // Defensive: predicate already passed, but recompute the
        // ConvertibleElement view (typed shape) at click time so we
        // reuse currentConvertibleSelection's exact ConvertibleElement
        // contract without duplicating the type narrowing.
        const el = currentConvertibleSelection();
        if (el) handleConvert(el);
        // handleConvert performs the scene mutation directly via
        // excalidrawAPI.updateScene; return false so the
        // ContextMenu/actionManager updater doesn't try to re-apply
        // anything on top.
        return false;
      },
    });
    return unregister;
  }, [excalidrawAPI, handleConvert, currentConvertibleSelection]);

  // W-B — Composite PNG export, surfaced in MainMenu. Async work fires-and-
  // forgets; MainMenu.Item.onSelect is sync (event handler signature) and
  // the menu closes synchronously after handler returns.
  const handleExportPNG = useCallback(() => {
    if (!map || !excalidrawAPI) return;
    void (async () => {
      try {
        const blob = await exportPNG(map, excalidrawAPI, { backgroundColor: mapBg });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `atlasdraw-${Date.now()}.png`;
        a.click();
        URL.revokeObjectURL(url);
      } catch (err) {
        window.alert(
          `PNG export failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    })();
  }, [map, excalidrawAPI, mapBg]);

  // Intercept ChangeCanvasBackground: keep Excalidraw transparent so the map
  // shows through, and store the chosen color in mapBg for CSS + export.
  //
  // Also enforces identity scroll/zoom (scroll lock) and handles post-file-load
  // sync. Two invariants that Atlas relies on:
  //
  //   1. Scroll lock — Excalidraw must keep scrollX=0, scrollY=0, zoom=1 so
  //      that scene coordinates equal screen pixels. After file load, Excalidraw
  //      calls scrollToContent which breaks this. We detect and immediately reset.
  //      The geo sync runs on the following onChange once scroll is at identity.
  //
  //   2. Post-load sync — loading a .excalidraw file emits no camera events, so
  //      geo-anchored elements stay at their canonical zoom-0 coordinates until
  //      the user pans. We detect this by comparing the first geo element's scene
  //      position against map.project(anchor) and calling syncNow() if delta>10px.
  //      The self-terminating property: after sync, el.x == map.project(anchor)
  //      so delta==0 on the follow-up onChange.
  const handleExcalidrawChange = useCallback<
    NonNullable<React.ComponentProps<typeof Excalidraw>["onChange"]>
  >(
    (elements, appState) => {
      // --- 1. Background color intercept ---
      if (appState.viewBackgroundColor !== "transparent") {
        setMapBg(appState.viewBackgroundColor);
        // Only queue one reset at a time. CoordinateSync fires many onChange
        // events (one per camera event) before React processes our setState;
        // without this guard each fires another updateScene, exhausting
        // React's 50-nested-update limit ("Maximum update depth exceeded").
        if (!bgResetQueuedRef.current) {
          bgResetQueuedRef.current = true;
          excalidrawAPI?.updateScene({
            appState: { viewBackgroundColor: "transparent" },
          });
        }
      } else {
        bgResetQueuedRef.current = false;
      }

      // --- 2. Scroll lock ---
      // After file load, Excalidraw calls scrollToContent setting non-zero
      // scrollX/Y. With non-zero scroll, `el.x + scrollX` ≠ `map.project(anchor).x`
      // so elements appear shifted from their geo positions and reanchorIfMoved
      // picks up false user-drag deltas. Reset to identity; geo sync runs next tick.
      if (appState.scrollX !== 0 || appState.scrollY !== 0 || appState.zoom.value !== 1) {
        excalidrawAPI?.updateScene({
          appState: { scrollX: 0, scrollY: 0, zoom: { value: 1 } },
        });
        return;
      }

      // --- 3. Post-load geo sync (scroll is identity here) ---
      if (map && syncNow) {
        for (const el of elements) {
          const cd = (el as { customData?: unknown }).customData;
          if (!isGeoCustomData(cd)) continue;
          const anchor = cd.geo;
          const ref =
            anchor.kind === "point"
              ? map.project([anchor.lng, anchor.lat] as [number, number])
              : anchor.kind === "bbox"
                ? map.project([anchor.west, anchor.north] as [number, number])
                : map.project(anchor.coordinates[0] as [number, number]);
          if (Math.abs((el as { x: number }).x - ref.x) > 10 || Math.abs((el as { y: number }).y - ref.y) > 10) {
            syncNow();
          }
          break; // O(1): only inspect the first geo element
        }
      }

      // --- 4. T9 — mark persistence dirty (gated on real element mutation).
      // Excalidraw fires onChange on initial mount, viewport changes, scroll-
      // lock self-fires, and selection updates — none of which are user
      // edits. Mark dirty only when the elements reference actually changes
      // from the prior call, AND skip the first call (which establishes the
      // baseline). The underlying PersistenceStore debounces (5s) + ceilings
      // (30s) so the actual IDB write rate stays bounded.
      const prev = prevElementsRef.current;
      prevElementsRef.current = elements;
      if (prev !== null && elements !== prev) {
        usePersistenceStore.getState().markDirty();
      }
    },
    [excalidrawAPI, map, syncNow],
  );

  // Provide the live MapLibre canvas to Excalidraw's native Save as Image /
  // Copy as PNG so they composite basemap + annotations in a single export.
  const getBackgroundCanvas = useCallback(
    (): HTMLCanvasElement | null => (map ? map.getCanvas() : null),
    [map],
  );

  return (
    <div ref={rootRef} className={styles.root} style={{ backgroundColor: mapBg }}>
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
          UIOptions={{ canvasActions: { export: exportOpts } }}
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
            <MainMenu.DefaultItems.LoadScene />
            <MainMenu.DefaultItems.SaveToActiveFile />
            {/* atlasdraw-9078 (Phase 4 W0 prereq): the adjacent
                Save/Open `.atlasdraw…` items that lived here under T9
                were unified INTO Excalidraw's existing JSONExport dialog
                via `renderCustomUI` — see `renderAtlasdrawExportCards`
                above. Single entry point: MainMenu → Export. */}
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
            <MainMenu.DefaultItems.Export />
            <MainMenu.Item
              onSelect={handleExportPNG}
              data-testid="main-menu-export-png"
            >
              Export composite PNG (with basemap)
            </MainMenu.Item>
            <MainMenu.Separator />
            <MainMenu.Item
              onSelect={() => setActiveAtlasTool(isPinActive ? null : PinTool)}
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
            <MainMenu.DefaultItems.Help />
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
              🗺 Basemap
            </MainMenu.Item>
            {showBasemapPicker && (
              <BasemapPickerDialog
                activeId={activeBasemapId}
                onSelect={setActiveBasemapId}
                onCloseRequest={() => setShowBasemapPicker(false)}
              />
            )}
            <MainMenu.DefaultItems.ToggleTheme />
          </MainMenu>
        </Excalidraw>
      </div>

      {/* Atlas-tool interaction overlay — only mounted when an atlas-tool is
          active. Captures pointerdown above Excalidraw (zIndex 5) so map clicks
          flow into our tool dispatcher instead of becoming Excalidraw selection
          rectangles. Unmounted otherwise so map pan/zoom is unaffected. */}
      {activeAtlasTool && (
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
      )}
    </div>
  );
}
