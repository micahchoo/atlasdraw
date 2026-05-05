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
import { Excalidraw } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw";
import type { FeatureCollection } from "geojson";
import type maplibregl from "maplibre-gl";
import { PinTool } from "@atlasdraw/tools";
import { useMapRef } from "../hooks/useMapRef";
import { useCoordinateSync } from "../hooks/useCoordinateSync";
import { useGeoAnchor } from "../hooks/useGeoAnchor";
import { useToolState } from "../hooks/useToolState";
import { useAtlasdrawTool } from "../hooks/useAtlasdrawTool";
import { useMapWheelRouter } from "../hooks/useMapWheelRouter";
import { useLayerRegistry } from "../hooks/useLayerRegistry";
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

  // T13 — GeoJSON drag-and-drop import. Drop handler attaches to the root
  // div (NOT the Excalidraw layer; Excalidraw owns its own pointer/drop
  // events). dragover.preventDefault() is mandatory — without it the browser
  // refuses to fire `drop`.
  const registry = useLayerRegistry();
  const handleDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
    },
    [],
  );
  const handleDrop = useCallback(
    async (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const file = e.dataTransfer?.files?.[0];
      if (!file || !file.name.endsWith(".geojson")) return;
      if (!map) return;
      try {
        // parse() accepts a Blob; File extends Blob, so we pass it directly.
        const fc = await parse(file);
        const id = `dl:${crypto.randomUUID()}`;
        const style = defaultLayerStyle(fc);
        const geometryType = inferGeometryType(fc);
        registry.registerDataLayer({ id, fc, label: file.name, style });
        map.addSource(id, { type: "geojson", data: fc });
        map.addLayer(compileLayer(id, style, geometryType));
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

  return (
    <div
      ref={rootRef}
      className={styles.root}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
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
        />
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

      {/* Pin button — fixed top-left, above all layers. Toggle activates
          PinTool (next click on map places one pin, then deactivates). */}
      <button
        type="button"
        className={[
          styles.pinButton,
          isPinActive ? styles.pinButtonActive : "",
        ]
          .filter(Boolean)
          .join(" ")}
        onClick={() => setActiveAtlasTool(isPinActive ? null : PinTool)}
        aria-pressed={isPinActive}
        data-testid="pin-tool-button"
      >
        Pin
      </button>
    </div>
  );
}
