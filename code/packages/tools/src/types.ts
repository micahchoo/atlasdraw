// packages/tools/src/types.ts
// SPDX-License-Identifier: MPL-2.0
// AtlasdrawTool interface — Phase 1 Wave 0 Task 2.
// See docs/architecture/subsystems/tools/contracts.md for the full contract.

import type { ReactNode } from "react";
import type { GeoAnchor, ScaleMode } from "@atlasdraw/geo";

/**
 * The shape MapLibre passes back from `unproject`.
 * Avoids requiring `maplibre-gl` here (this package would force a heavy import).
 */
export interface LngLatLike {
  lng: number;
  lat: number;
}

/**
 * Pointer event passed to tool handlers. Subset of DOM PointerEvent we care about.
 * Tools should never reach into the DOM directly — accept only this shape.
 */
export interface ToolPointerEvent {
  clientX: number;
  clientY: number;
  pointerId: number;
  pointerType: "mouse" | "pen" | "touch";
  button: number; // 0=primary, 1=middle, 2=secondary
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

/**
 * Context provided to every tool handler. Tools never directly mutate state;
 * they call ctx methods that go through the central scene API.
 *
 * Designed to be postMessage-safe per Q11 (so plugin tools work via Worker boundary in Phase 7).
 */
export interface ToolContext {
  /** MapLibre instance — tools use only `project` / `unproject` / `getZoom`. Other access is discouraged. */
  readonly map: {
    project: (lngLat: [number, number]) => { x: number; y: number };
    unproject: (point: [number, number]) => LngLatLike;
    getZoom: () => number;
    getBounds: () => {
      getNorth: () => number;
      getSouth: () => number;
      getEast: () => number;
      getWest: () => number;
    };
  };
  /** Excalidraw API surface — tools call addElement, not direct mutate. */
  readonly excalidraw: {
    addElement: (element: AtlasdrawElementSeed) => string; // returns element id
    updateElement: (id: string, patch: Partial<AtlasdrawElementSeed>) => void;
    getActiveTool: () => string;
  };
  /** App-level callbacks — popups, status bar, snackbar. */
  readonly ui: {
    showPopup: (lngLat: LngLatLike, content: ReactNode) => void;
    setStatusBarMessage: (msg: string) => void;
  };
}

/**
 * Element seed passed when a tool wants to create a new Excalidraw element.
 * Geo-anchored — see @atlasdraw/geo for GeoAnchor and ScaleMode.
 */
export interface AtlasdrawElementSeed {
  /** Excalidraw element type or "custom" for our extension types. */
  type:
    | "rectangle"
    | "ellipse"
    | "line"
    | "freedraw"
    | "text"
    | "arrow"
    | "custom";
  /** Required for `type: "custom"` — picks our specific tool variant (e.g., "pin"). */
  customType?: string;
  /** Geo anchor — mandatory for tools created via Atlasdraw. */
  geo: GeoAnchor;
  scaleMode: ScaleMode;
  /** Visual style — minimal subset; full styling comes Phase 6. */
  style?: {
    strokeColor?: string;
    fillColor?: string;
    strokeWidth?: number;
    opacity?: number; // 0-1
  };
  /** Optional metadata that survives serialization (popup contents, labels, etc.) */
  data?: Record<string, unknown>;
}

/**
 * AtlasdrawTool — the contract every geo-aware tool implements.
 *
 * Lifecycle:
 *   user selects tool -> onActivate? -> onPointerDown -> ... -> onPointerUp? -> onDeactivate?
 *
 * State machine: idle -> active -> drawing -> committed -> idle
 *
 * No async methods in v1 (kept synchronous to match Excalidraw's tool model).
 */
export interface AtlasdrawTool {
  /** Stable id, registered into Excalidraw via customType. */
  readonly id: string;
  /** User-facing label. */
  readonly label: string;
  /** Path or component for the toolbar icon (Phase 1: just a string identifier). */
  readonly icon: string;
  /** CSS cursor when this tool is active. */
  readonly cursor: string;
  /**
   * Default scale-mode for elements this tool produces.
   * Tools may override per-element via the seed's `scaleMode`, but this declares
   * the tool's intent at definition site (queryable for toolbar UI / Phase 6 mode-toggle).
   */
  readonly defaultScaleMode: ScaleMode;

  /** Optional: lifecycle hooks. */
  onActivate?(ctx: ToolContext): void;
  onDeactivate?(ctx: ToolContext): void;

  /** Required: pointer-down committed event. */
  onPointerDown(e: ToolPointerEvent, ctx: ToolContext): void;

  /** Optional: pointer-move while pointer is down (for drag tools). */
  onPointerMove?(e: ToolPointerEvent, ctx: ToolContext): void;

  /** Optional: pointer-up (commit point for drag tools). */
  onPointerUp?(e: ToolPointerEvent, ctx: ToolContext): void;

  /** Optional: keyboard interaction while tool is active (Escape, Enter, etc.). */
  onKeyDown?(e: KeyboardEvent, ctx: ToolContext): void;
}

/**
 * ToolRegistry — central registry of all available tools.
 * Built up in `apps/atlas-app` from `@atlasdraw/tools` exports.
 */
export type ToolRegistry = ReadonlyMap<string, AtlasdrawTool>;
