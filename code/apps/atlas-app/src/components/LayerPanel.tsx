// SPDX-License-Identifier: AGPL-3.0-only
// Phase 2 Wave 2b T12 — LayerPanel.
//
// Renders an Excalidraw <Sidebar name="layers"> tab with two sections —
// data layers and annotations — sourced from the LayerRegistry Zustand store.
//
// Sidebar API (verified in vendored Excalidraw v0.18 source):
//   code/packages/excalidraw/index.tsx:342
//     export { Sidebar } from "./components/Sidebar/Sidebar";
//   code/packages/excalidraw/components/Sidebar/common.ts:17
//     export type SidebarProps<P = {}> = {
//       name: SidebarName;
//       children: React.ReactNode;
//       docked?: boolean;
//       ...
//     };
//   Sidebar exposes static subcomponents (Header, Tabs, TabTriggers, Tab,
//   Trigger, TabTrigger). `Sidebar.Header` is the title slot.
//
// Sidebar internally checks `appState.openSidebar?.name === props.name`
// and short-circuits to null when not open. The host Excalidraw editor
// is responsible for opening "layers" (e.g. via a SidebarTrigger). For
// unit tests we mock the export.
//
// Plan: docs/superpowers/plans/2026-05-03-atlasdraw-phase-2-tools-data-layers.md §T12
// Pre-dispatch scrub: docs/decisions/wave2-pre-dispatch-scrub-2026-05-04.md §1 §2 §6

import React from "react";
import { Sidebar } from "@excalidraw/excalidraw";

import { useLayerRegistry } from "../hooks/useLayerRegistry";
import type {
  LayerRegistryEntry,
  AnnotationLayerEntry,
  DataLayerEntry,
  LayerStyle,
} from "../state/layerRegistry";

// ---------------------------------------------------------------------------
// Row components
// ---------------------------------------------------------------------------

type Mutators = {
  setVisibility: (id: string, visible: boolean) => void;
  reorder: (id: string, newOrder: number) => void;
  updateStyle: (id: string, patch: Partial<LayerStyle>) => void;
};

function DataLayerRow({
  entry,
  mutators,
}: {
  entry: DataLayerEntry;
  mutators: Mutators;
}) {
  const { setVisibility, reorder, updateStyle } = mutators;
  const { id, label, visible, order, featureCount, style } = entry;

  return (
    <div
      data-testid={`layer-row-${id}`}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        padding: "6px 8px",
        borderBottom: "1px solid #eee",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <button
          type="button"
          aria-label={visible ? "Hide layer" : "Show layer"}
          aria-pressed={visible}
          onClick={() => setVisibility(id, !visible)}
        >
          {visible ? "\u{1F441}" : "\u{1F441}̷"}
        </button>
        {/* Non-color-only kind indicator — accessibility (plan §6 scrub). */}
        <span
          aria-label="Data layer"
          style={{
            display: "inline-block",
            minWidth: 16,
            padding: "0 4px",
            borderRadius: 3,
            background: "#dbeafe",
            color: "#1e3a8a",
            fontSize: 10,
            fontWeight: 700,
            textAlign: "center",
          }}
        >
          D
        </span>
        <span style={{ flex: 1 }}>{label}</span>
        <span style={{ fontSize: 11, color: "#888" }}>
          {featureCount} feat
        </span>
        <button
          type="button"
          aria-label="Move layer up"
          onClick={() => reorder(id, order - 1)}
        >
          {"↑"}
        </button>
        <button
          type="button"
          aria-label="Move layer down"
          onClick={() => reorder(id, order + 1)}
        >
          {"↓"}
        </button>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr",
          gap: 4,
          fontSize: 11,
        }}
      >
        <label htmlFor={`fill-${id}`}>fill</label>
        <input
          id={`fill-${id}`}
          type="color"
          value={style.fillColor ?? "#000000"}
          onChange={(e) => updateStyle(id, { fillColor: e.target.value })}
        />
        <label htmlFor={`stroke-${id}`}>stroke</label>
        <input
          id={`stroke-${id}`}
          type="color"
          value={style.strokeColor ?? "#000000"}
          onChange={(e) => updateStyle(id, { strokeColor: e.target.value })}
        />
        <label htmlFor={`stroke-width-${id}`}>width</label>
        <input
          id={`stroke-width-${id}`}
          type="number"
          min={0}
          step={1}
          value={style.strokeWidth ?? 1}
          onChange={(e) =>
            updateStyle(id, { strokeWidth: Number(e.target.value) })
          }
        />
        <label htmlFor={`opacity-${id}`}>opacity</label>
        <input
          id={`opacity-${id}`}
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={style.opacity ?? 1}
          onChange={(e) =>
            updateStyle(id, { opacity: Number(e.target.value) })
          }
        />
      </div>
    </div>
  );
}

function AnnotationLayerRow({
  entry,
  mutators,
}: {
  entry: AnnotationLayerEntry;
  mutators: Mutators;
}) {
  const { setVisibility, reorder } = mutators;
  const { id, label, visible, order } = entry;

  // TODO(T14-adjacent): registry-only visibility flip lands here today.
  // Mutating the actual Excalidraw element via excalidrawAPI.updateScene
  // is deferred until Wave 2c — see plan §844.
  return (
    <div
      data-testid={`layer-row-${id}`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 8px",
        borderBottom: "1px solid #eee",
      }}
    >
      <button
        type="button"
        aria-label={visible ? "Hide annotation" : "Show annotation"}
        aria-pressed={visible}
        onClick={() => setVisibility(id, !visible)}
      >
        {visible ? "\u{1F441}" : "\u{1F441}̷"}
      </button>
      <span
        aria-label="Annotation"
        style={{
          display: "inline-block",
          minWidth: 16,
          padding: "0 4px",
          borderRadius: 3,
          background: "#fef3c7",
          color: "#92400e",
          fontSize: 10,
          fontWeight: 700,
          textAlign: "center",
        }}
      >
        A
      </span>
      <span style={{ flex: 1 }}>{label}</span>
      <button
        type="button"
        aria-label="Move annotation up"
        onClick={() => reorder(id, order - 1)}
      >
        {"↑"}
      </button>
      <button
        type="button"
        aria-label="Move annotation down"
        onClick={() => reorder(id, order + 1)}
      >
        {"↓"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LayerPanel
// ---------------------------------------------------------------------------

const byOrder = (a: LayerRegistryEntry, b: LayerRegistryEntry) =>
  a.order - b.order;

export function LayerPanel() {
  const { entries, setVisibility, reorder, updateStyle } = useLayerRegistry();

  const mutators: Mutators = { setVisibility, reorder, updateStyle };

  const dataLayers = entries
    .filter((e): e is DataLayerEntry => e.kind === "data")
    .slice()
    .sort(byOrder);
  const annotations = entries
    .filter((e): e is AnnotationLayerEntry => e.kind === "annotation")
    .slice()
    .sort(byOrder);

  return (
    <Sidebar name="layers" docked>
      <Sidebar.Header>Layers</Sidebar.Header>
      <section
        aria-label="Data Layers"
        style={{ borderBottom: "2px solid #ccc" }}
      >
        <h3 style={{ margin: 0, padding: "4px 8px", fontSize: 12 }}>
          Data Layers
        </h3>
        {dataLayers.length === 0 ? (
          <p style={{ padding: "4px 8px", fontSize: 11, color: "#888" }}>
            (none — drop a GeoJSON file)
          </p>
        ) : (
          dataLayers.map((entry) => (
            <DataLayerRow key={entry.id} entry={entry} mutators={mutators} />
          ))
        )}
      </section>
      <section aria-label="Annotations">
        <h3 style={{ margin: 0, padding: "4px 8px", fontSize: 12 }}>
          Annotations
        </h3>
        {annotations.length === 0 ? (
          <p style={{ padding: "4px 8px", fontSize: 11, color: "#888" }}>
            (none — draw with Excalidraw tools)
          </p>
        ) : (
          annotations.map((entry) => (
            <AnnotationLayerRow
              key={entry.id}
              entry={entry}
              mutators={mutators}
            />
          ))
        )}
      </section>
    </Sidebar>
  );
}
