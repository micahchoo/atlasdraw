// SPDX-License-Identifier: AGPL-3.0-only
//
// MeasureLayer (W9) — everything that measures, in one mount:
//
//   * the Measure tool. While it is on, an overlay above the drawing (the
//     atlas-tool band, z 5) takes the clicks: each click adds a point, a
//     double-click or Enter ends the path, Backspace removes the last point,
//     Escape exits. A drag pans the map. The path is kept in lng/lat
//     (`measureStep`) and drawn by projecting it, so it stays on the ground
//     when the map pans, zooms or turns. "Keep as line" makes it a drawn line.
//   * the selection readout. With one element selected and no tool on, the
//     tool-options bar shows its length, or its area and perimeter, and an
//     ellipse's radius or semi-axes.
//
// Both measure through the document's world frame (`measureShape`,
// `scenePathLength`), so a kept line reads the same as the path it came from.
//
// The `m` key, Enter, Backspace and Escape are read on window in the capture
// phase and stopped there while the tool is on: Excalidraw listens on
// document, and Backspace there deletes the selection.

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";

import { CaptureUpdateAction } from "@atlasdraw/element";
import { measureShape, scenePathLength, toScene } from "@atlasdraw/geo";
import {
  IDLE_MEASURE,
  formatArea,
  formatLength,
  measureStep,
  shownPath,
} from "@atlasdraw/tools";

import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw";
import type { ExcalidrawElement } from "@atlasdraw/element/types";
import type { LngLat, ShapeMeasure, WorldFrame } from "@atlasdraw/geo";
import type { UnitSystem } from "@atlasdraw/tools";

import { buildToolContext } from "../hooks/useAtlasdrawTool";
import { currentDocument } from "../state/document";
import { useSession, useView } from "../session/SessionContext";
import styles from "../styles/MeasureLayer.module.css";

import { ToolOptionsBar } from "./ToolOptionsBar";

import type maplibregl from "maplibre-gl";

/** A pointer that moves less than this between down and up has clicked. */
const CLICK_SLOP_PX = 4;
/** A click this close to the last point ends the path (a double-click). */
const END_RADIUS_PX = 6;

/** Semi-axes closer than this are one radius. */
const ROUND_TOLERANCE = 0.01;

type MeasureMap = Pick<
  maplibregl.Map,
  | "project"
  | "unproject"
  | "getContainer"
  | "getZoom"
  | "getBounds"
  | "on"
  | "off"
  | "panBy"
>;

export interface MeasureLayerProps {
  map: maplibregl.Map | null;
  excalidrawAPI: ExcalidrawImperativeAPI | null;
  /** True while the Pin tool or comment mode owns the click. */
  otherToolActive: boolean;
  /** Called when the Measure tool turns on: drop the other atlas tool. */
  onStart: () => void;
}

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return (
    !!el?.tagName &&
    (el.tagName === "INPUT" ||
      el.tagName === "TEXTAREA" ||
      el.tagName === "SELECT" ||
      el.isContentEditable === true)
  );
}

const frame = (): WorldFrame => currentDocument().snapshot().world;

/** Ground length of a lng/lat path drawn straight on the map, metres. */
function pathLength(path: readonly LngLat[]): number {
  const f = frame();
  return scenePathLength(
    f,
    path.map((p) => toScene(f, p.lng, p.lat)),
  );
}

// ---------------------------------------------------------------------------
// Units toggle — shared by both bars
// ---------------------------------------------------------------------------

function UnitsButton({
  units,
  onToggle,
}: {
  units: UnitSystem;
  onToggle: () => void;
}) {
  const other = units === "metric" ? "imperial" : "metric";
  return (
    <button
      type="button"
      className={styles.unitsButton}
      onClick={onToggle}
      aria-label={`Units: ${units}. Change to ${other}`}
      title={`Change to ${other} units`}
      data-testid="measure-units-button"
    >
      {units === "metric" ? "m, km" : "ft, mi"}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Selection readout
// ---------------------------------------------------------------------------

const TYPE_NAMES: Readonly<Record<string, string>> = {
  line: "Line",
  arrow: "Arrow",
  freedraw: "Freehand line",
  rectangle: "Rectangle",
  diamond: "Diamond",
  ellipse: "Ellipse",
};

/** The one selected element, unless it is a pin. Null otherwise. */
function selectedOne(api: ExcalidrawImperativeAPI): ExcalidrawElement | null {
  const ids = Object.keys(api.getAppState()?.selectedElementIds ?? {});
  if (ids.length !== 1) {
    return null;
  }
  const el = api.getSceneElements().find((e) => e.id === ids[0]);
  const tool = (el?.customData as { tool?: unknown } | undefined)?.tool;
  return el && tool !== "pin" ? el : null;
}

/** The selected element, as state that changes only when it changes. */
function useSelectedElement(
  api: ExcalidrawImperativeAPI | null,
): ExcalidrawElement | null {
  const [el, setEl] = useState<ExcalidrawElement | null>(null);
  useEffect(() => {
    if (!api) {
      setEl(null);
      return;
    }
    const read = () => {
      const next = selectedOne(api);
      setEl((prev) =>
        prev?.id === next?.id && prev?.version === next?.version ? prev : next,
      );
    };
    read();
    return api.onChange(read);
  }, [api]);
  return el;
}

function radiusText(m: ShapeMeasure, units: UnitSystem): string | null {
  if (m.kind !== "area" || !m.radii) {
    return null;
  }
  const { a, b } = m.radii;
  if (Math.abs(a - b) <= ROUND_TOLERANCE * Math.max(a, b)) {
    return `Radius ${formatLength((a + b) / 2, units)}`;
  }
  return `Semi-axes ${formatLength(Math.max(a, b), units)} × ${formatLength(
    Math.min(a, b),
    units,
  )}`;
}

function SelectionReadout({
  el,
  units,
  onToggleUnits,
}: {
  el: ExcalidrawElement;
  units: UnitSystem;
  onToggleUnits: () => void;
}) {
  const m = useMemo(() => measureShape(frame(), el), [el]);
  if (!m || (m.kind === "length" ? m.length : m.perimeter) === 0) {
    return null;
  }
  const radius = radiusText(m, units);
  return (
    <ToolOptionsBar
      label={TYPE_NAMES[el.type] ?? "Shape"}
      testId="measure-readout"
    >
      {m.kind === "length" ? (
        <span className={styles.value} data-testid="measure-length">
          Length {formatLength(m.length, units)}
        </span>
      ) : (
        <>
          <span className={styles.value} data-testid="measure-area">
            Area {formatArea(m.area, units)}
          </span>
          <span className={styles.value} data-testid="measure-perimeter">
            Perimeter {formatLength(m.perimeter, units)}
          </span>
          {radius && (
            <span className={styles.value} data-testid="measure-radius">
              {radius}
            </span>
          )}
        </>
      )}
      <UnitsButton units={units} onToggle={onToggleUnits} />
    </ToolOptionsBar>
  );
}

// ---------------------------------------------------------------------------
// Measure tool
// ---------------------------------------------------------------------------

function MeasureTool({
  map,
  excalidrawAPI,
  units,
  onToggleUnits,
  onExit,
}: {
  map: MeasureMap;
  excalidrawAPI: ExcalidrawImperativeAPI | null;
  units: UnitSystem;
  onToggleUnits: () => void;
  onExit: () => void;
}) {
  const [state, dispatch] = useReducer(measureStep, IDLE_MEASURE);
  const overlayRef = useRef<HTMLDivElement>(null);
  const press = useRef<{
    x: number;
    y: number;
    lastX: number;
    lastY: number;
    dragged: boolean;
  } | null>(null);

  // Redraw the path when the camera moves: it is kept in lng/lat.
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    map.on("move", redraw);
    return () => {
      map.off("move", redraw);
    };
  }, [map]);

  /** Viewport point → lng/lat. MapLibre's unproject applies the bearing. */
  const lngLatAt = useCallback(
    (clientX: number, clientY: number): LngLat => {
      const r = map.getContainer().getBoundingClientRect();
      const ll = map.unproject([clientX - r.left, clientY - r.top]);
      return { lng: ll.lng, lat: ll.lat };
    },
    [map],
  );

  const keepAsLine = useCallback(() => {
    if (!excalidrawAPI || state.points.length < 2) {
      return;
    }
    const ctx = buildToolContext(map, excalidrawAPI);
    const id = ctx.excalidraw.addElement({
      type: "line",
      geo: {
        kind: "polyline",
        coordinates: state.points.map((p) => [p.lng, p.lat]),
        zRef: map.getZoom(),
      },
    });
    excalidrawAPI.updateScene({
      appState: { selectedElementIds: { [id]: true } },
      captureUpdate: CaptureUpdateAction.NEVER,
    });
    onExit();
  }, [excalidrawAPI, map, onExit, state.points]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) {
        return;
      }
      const handled =
        e.key === "Escape"
          ? (onExit(), true)
          : e.key === "Enter"
          ? (dispatch({ type: "finish" }), true)
          : e.key === "Backspace" || e.key === "Delete"
          ? (dispatch({ type: "undo" }), true)
          : false;
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onExit]);

  // Screen positions for the drawn path, relative to the overlay.
  const container = map.getContainer().getBoundingClientRect();
  const overlay = overlayRef.current?.getBoundingClientRect();
  const dx = container.left - (overlay?.left ?? container.left);
  const dy = container.top - (overlay?.top ?? container.top);
  const path = shownPath(state);
  const screenPts = path.map((p) => {
    const s = map.project([p.lng, p.lat]);
    return `${s.x + dx},${s.y + dy}`;
  });

  const distance =
    state.points.length === 0
      ? "Click the map to start"
      : formatLength(pathLength(path), units);

  return (
    <>
      <div
        ref={overlayRef}
        className={styles.overlay}
        data-testid="measure-overlay"
        onPointerDown={(e) => {
          if (e.button !== 0) {
            return;
          }
          e.currentTarget.setPointerCapture?.(e.pointerId);
          press.current = {
            x: e.clientX,
            y: e.clientY,
            lastX: e.clientX,
            lastY: e.clientY,
            dragged: false,
          };
        }}
        onPointerMove={(e) => {
          const p = press.current;
          if (p && (e.buttons & 1) === 1) {
            if (
              !p.dragged &&
              Math.hypot(e.clientX - p.x, e.clientY - p.y) > CLICK_SLOP_PX
            ) {
              p.dragged = true;
            }
            if (p.dragged) {
              map.panBy([p.lastX - e.clientX, p.lastY - e.clientY], {
                animate: false,
              });
              p.lastX = e.clientX;
              p.lastY = e.clientY;
            }
            return;
          }
          dispatch({ type: "move", at: lngLatAt(e.clientX, e.clientY) });
        }}
        onPointerUp={(e) => {
          const p = press.current;
          press.current = null;
          if (!p || p.dragged || e.button !== 0) {
            return;
          }
          const at = lngLatAt(e.clientX, e.clientY);
          const last = state.points[state.points.length - 1];
          let nearLast = false;
          if (last) {
            const r = map.getContainer().getBoundingClientRect();
            const s = map.project([last.lng, last.lat]);
            nearLast =
              Math.hypot(s.x + r.left - e.clientX, s.y + r.top - e.clientY) <=
              END_RADIUS_PX;
          }
          dispatch({ type: "click", at, nearLast });
        }}
        onDoubleClick={() => dispatch({ type: "finish" })}
      >
        <svg className={styles.path} aria-hidden="true">
          {screenPts.length > 1 && (
            <>
              <polyline className={styles.halo} points={screenPts.join(" ")} />
              <polyline className={styles.line} points={screenPts.join(" ")} />
            </>
          )}
          {screenPts.slice(0, state.points.length).map((pt, i) => {
            const [x, y] = pt.split(",");
            return (
              <circle key={i} className={styles.vertex} cx={x} cy={y} r={4} />
            );
          })}
        </svg>
      </div>
      <ToolOptionsBar label="Measure" testId="measure-tool-bar">
        <span className={styles.value} data-testid="measure-distance">
          {distance}
        </span>
        {state.phase === "done" && (
          <button
            type="button"
            className={styles.textButton}
            onClick={keepAsLine}
            disabled={!excalidrawAPI}
            data-testid="measure-keep-line"
          >
            Keep as line
          </button>
        )}
        <UnitsButton units={units} onToggle={onToggleUnits} />
        <span className={styles.separator} />
        <span className={styles.hint}>
          {state.phase === "done"
            ? "Click to start again · Esc to exit"
            : "Double-click or Enter to end · Esc to exit"}
        </span>
      </ToolOptionsBar>
    </>
  );
}

// ---------------------------------------------------------------------------

export function MeasureLayer({
  map,
  excalidrawAPI,
  otherToolActive,
  onStart,
}: MeasureLayerProps) {
  const { view } = useSession();
  const active = useView((s) => s.measuring);
  const units = useView((s) => s.units);
  const setActive = useView((s) => s.setMeasuring);
  const toggleUnits = useView((s) => s.toggleUnits);
  const selected = useSelectedElement(excalidrawAPI);

  // Turning on takes the click from the other tools.
  const onStartRef = useRef(onStart);
  onStartRef.current = onStart;
  useEffect(() => {
    if (active) {
      view.getState().setCommentMode(false);
      onStartRef.current();
    }
  }, [active, view]);

  // Another tool starting turns the Measure tool off. Only the change counts:
  // at the moment Measure turns on, the other tool is still on for one render.
  const otherWas = useRef(otherToolActive);
  useEffect(() => {
    if (otherToolActive && !otherWas.current) {
      setActive(false);
    }
    otherWas.current = otherToolActive;
  }, [otherToolActive, setActive]);

  // `m` turns the tool on and off.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.key.toLowerCase() === "m" &&
        !e.repeat &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !e.shiftKey &&
        !isTypingTarget(e.target)
      ) {
        e.preventDefault();
        view.getState().toggleMeasuring();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view]);

  const exit = useCallback(() => setActive(false), [setActive]);

  if (active && map) {
    return (
      <MeasureTool
        map={map}
        excalidrawAPI={excalidrawAPI}
        units={units}
        onToggleUnits={toggleUnits}
        onExit={exit}
      />
    );
  }
  if (!otherToolActive && selected) {
    return (
      <SelectionReadout
        el={selected}
        units={units}
        onToggleUnits={toggleUnits}
      />
    );
  }
  return null;
}
