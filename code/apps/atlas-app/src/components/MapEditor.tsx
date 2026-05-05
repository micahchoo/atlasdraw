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

import React, { useState, useEffect, useRef, useCallback } from "react";
import { MapCanvas } from "@atlasdraw/basemap";
import type { MapCanvasInitialView } from "@atlasdraw/basemap";
import { compileLayer, defaultLayerStyle } from "@atlasdraw/basemap";
import { parse, GeoJSONParseError } from "@atlasdraw/data";
import { Excalidraw, MainMenu } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw";
import type { FeatureCollection } from "geojson";
import type maplibregl from "maplibre-gl";
import {
  PinTool,
  annotationToFeatureCollection,
  UnsupportedConvertElementError,
  type ConvertibleElement,
} from "@atlasdraw/tools";
import { isGeoCustomData } from "@atlasdraw/geo";
import { useMapRef } from "../hooks/useMapRef";
import { useCoordinateSync } from "../hooks/useCoordinateSync";
import { useGeoAnchor } from "../hooks/useGeoAnchor";
import { useLayerRegistrySync } from "../hooks/useLayerRegistrySync";
import { useToolState } from "../hooks/useToolState";
import { useAtlasdrawTool } from "../hooks/useAtlasdrawTool";
import { useMapWheelRouter } from "../hooks/useMapWheelRouter";
import { useLayerRegistry } from "../hooks/useLayerRegistry";
import { LayerPanel } from "./LayerPanel";
import { exportPNG } from "../lib/export";
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
  // Root container ref — used by useMapWheelRouter to intercept wheel events
  // in capture phase before they reach the Excalidraw layer (atlasdraw-5afc).
  const rootRef = useRef<HTMLDivElement>(null);

  // Fire onMount exactly once per (map, api) tuple. `onMount` is intentionally
  // excluded from deps so a re-rendered parent passing a fresh closure doesn't
  // retrigger the callback.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (map && excalidrawAPI) {
      onMount?.(map, excalidrawAPI);
    }
  }, [map, excalidrawAPI]); // onMount excluded: fire-once-per-tuple semantics

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

  // Wire camera events → CoordinateSync.syncMapToScene (throttled at 16ms).
  useCoordinateSync(map, excalidrawAPI);

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
      // text/arrow elements carry geo but aren't convertible (Wave 3b T14
      // scrub §7). annotationToFeatureCollection throws
      // UnsupportedConvertElementError for them; we filter at the gate so
      // the menu item shows enabled only when the conversion will actually
      // succeed.
      if (el.type === "text" || el.type === "arrow") return null;
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
        if (el.type === "text" || el.type === "arrow") return false;
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
        const blob = await exportPNG(map, excalidrawAPI);
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
  }, [map, excalidrawAPI]);

  return (
    <div ref={rootRef} className={styles.root}>
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
        >
          {/* T22 — Layers sidebar slot. LayerPanel internally renders
              <Sidebar name="layers">. Excalidraw surfaces it only when
              appState.openSidebar?.name === "layers" — toggled via the
              MainMenu "Layers panel" item below. */}
          <LayerPanel />

          {/* W-B — Atlasdraw MainMenu items. Replaces 3 free-floating
              surfaces (Pin button, Layers toggle, Export PNG button) with
              proper Excalidraw v0.18 slots. (Convert moved to the right-
              click element context menu via excalidrawAPI.registerContext-
              MenuItem — see useEffect below.) MainMenu.Item is
              DropdownMenuItem under the hood
              (packages/excalidraw/components/dropdownMenu/DropdownMenuItem.tsx)
              — props: onSelect (event: Event) => void, icon, shortcut,
              data-testid. The hamburger trigger lives in the default
              Excalidraw UI (top-left); these items render inside it. */}
          <MainMenu>
            <MainMenu.Item
              onSelect={() => setActiveAtlasTool(isPinActive ? null : PinTool)}
              data-testid="main-menu-pin"
              aria-pressed={isPinActive}
            >
              {isPinActive ? "✓ Pin to map" : "Pin to map"}
            </MainMenu.Item>
            <MainMenu.Item
              onSelect={() =>
                excalidrawAPI?.toggleSidebar({ name: "layers" })
              }
              data-testid="main-menu-layers"
            >
              Layers panel
            </MainMenu.Item>
            <MainMenu.Item
              onSelect={handleExportPNG}
              data-testid="main-menu-export-png"
            >
              Export composite PNG
            </MainMenu.Item>
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
