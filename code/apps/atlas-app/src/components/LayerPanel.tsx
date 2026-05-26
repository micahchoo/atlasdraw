// SPDX-License-Identifier: AGPL-3.0-only
// Phase 2 Wave 2b T12 — LayerPanel.
//
// Two sections (data layers + annotations) sourced from the LayerRegistry
// Zustand store. Renders the panel BODY only — no Sidebar wrapper. The
// parent surface (DefaultSidebar via the atlasdraw fork's
// `excalidrawAPI.registerSidebarTab` API) provides the dockable shell,
// trigger button, and tab routing. MapEditor registers this component
// as the "layers" tab so it shares the existing Library trigger button
// instead of mounting a parallel sidebar that competes for the same
// screen surface.
//
// History: pre-`registerSidebarTab` revisions of this file rendered
// `<Sidebar name="layers">` directly. That carved out a parallel sidebar
// with no public trigger button and required a separate MainMenu item to
// open it. Removed in favor of the DefaultSidebar splice.
//
// Plan: docs/superpowers/plans/2026-05-03-atlasdraw-phase-2-tools-data-layers.md §T12
// Conventions: .claude/skills/atlasdraw-ui-conventions/SKILL.md

import React from "react";

import { useLayerRegistry } from "../hooks/useLayerRegistry";

import styles from "../styles/LayerPanel.module.css";

import { useAnnounce } from "./AriaAnnouncer";
import { StylePanel } from "./StylePanel";

import type {
  LayerRegistryEntry,
  AnnotationLayerEntry,
  DataLayerEntry,
  LayerStyle,
} from "../state/layerRegistry";

// ---------------------------------------------------------------------------
// Inline SVG icons — atlasdraw-ui-conventions §Icons:
//   - currentColor stroke so hover/active state propagates from button color
//   - sized via CSS (.icon class), not SVG attributes
//   - aria-hidden on the SVG; text label or sr-only span on the button.
// ---------------------------------------------------------------------------

function IconEye() {
  return (
    <svg
      className={styles.icon}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" />
      <circle cx="8" cy="8" r="2" />
    </svg>
  );
}

function IconEyeSlash() {
  return (
    <svg
      className={styles.icon}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" />
      <circle cx="8" cy="8" r="2" />
      <line x1="2" y1="2" x2="14" y2="14" />
    </svg>
  );
}

function IconChevronUp() {
  return (
    <svg
      className={styles.icon}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="3,10 8,5 13,10" />
    </svg>
  );
}

function IconChevronDown() {
  return (
    <svg
      className={styles.icon}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="3,6 8,11 13,6" />
    </svg>
  );
}

function joinClass(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(" ");
}

// ---------------------------------------------------------------------------
// Row components
// ---------------------------------------------------------------------------

type Mutators = {
  setVisibility: (id: string, visible: boolean) => void;
  reorder: (id: string, newOrder: number) => void;
  updateStyle: (id: string, patch: Partial<LayerStyle>) => void;
  openStyle: (id: string) => void;
};

function DataLayerRow({
  entry,
  mutators,
}: {
  entry: DataLayerEntry;
  mutators: Mutators;
}) {
  const { setVisibility, reorder, updateStyle, openStyle } = mutators;
  const { id, label, visible, order, featureCount, style } = entry;

  return (
    <div data-testid={`layer-row-${id}`} className={styles.row}>
      <div className={styles.rowHeader}>
        <button
          type="button"
          className={joinClass(
            styles.iconButton,
            visible && styles.iconButtonPressed,
          )}
          aria-label={visible ? "Hide layer" : "Show layer"}
          aria-pressed={visible}
          data-testid={`layer-visibility-${id}`}
          onClick={() => setVisibility(id, !visible)}
        >
          {visible ? <IconEye /> : <IconEyeSlash />}
        </button>
        {/* Non-color-only kind indicator — accessibility (plan §6 scrub). */}
        <span
          aria-label="Data layer"
          className={joinClass(styles.kindBadge, styles.kindBadgeData)}
        >
          D
        </span>
        <span className={styles.label}>{label}</span>
        <span className={styles.featureCount}>{featureCount} feat</span>
        <button
          type="button"
          className={styles.iconButton}
          aria-label="Move layer up"
          data-testid={`layer-up-${id}`}
          onClick={() => reorder(id, order - 1)}
        >
          <IconChevronUp />
        </button>
        <button
          type="button"
          className={styles.iconButton}
          aria-label="Move layer down"
          data-testid={`layer-down-${id}`}
          onClick={() => reorder(id, order + 1)}
        >
          <IconChevronDown />
        </button>
        <button
          type="button"
          className={styles.iconButton}
          aria-label="Open style editor"
          data-testid={`layer-style-${id}`}
          onClick={() => openStyle(id)}
          title="Style editor"
        >
          {/* Inline SVG palette icon — currentColor per atlasdraw-ui-conventions */}
          <svg
            className={styles.icon}
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M8 1.5a6.5 6.5 0 1 0 4 11.6c.5-.4.3-1.1-.3-1.1H10a1.5 1.5 0 0 1 0-3h2.5A2 2 0 0 0 14.5 7C14.5 4 11.6 1.5 8 1.5z" />
            <circle cx="5" cy="6" r="0.8" />
            <circle cx="8" cy="4" r="0.8" />
            <circle cx="11" cy="6" r="0.8" />
          </svg>
        </button>
      </div>
      <div className={styles.styleGrid}>
        <label htmlFor={`fill-${id}`} className={styles.styleGridLabel}>
          fill
        </label>
        <input
          id={`fill-${id}`}
          type="color"
          value={style.fillColor ?? "#000000"}
          data-testid={`layer-fill-${id}`}
          onChange={(e) => updateStyle(id, { fillColor: e.target.value })}
        />
        <label htmlFor={`stroke-${id}`} className={styles.styleGridLabel}>
          stroke
        </label>
        <input
          id={`stroke-${id}`}
          type="color"
          value={style.strokeColor ?? "#000000"}
          data-testid={`layer-stroke-${id}`}
          onChange={(e) => updateStyle(id, { strokeColor: e.target.value })}
        />
        <label htmlFor={`stroke-width-${id}`} className={styles.styleGridLabel}>
          width
        </label>
        <input
          id={`stroke-width-${id}`}
          type="number"
          min={0}
          step={1}
          value={style.strokeWidth ?? 1}
          data-testid={`layer-width-${id}`}
          onChange={(e) =>
            updateStyle(id, { strokeWidth: Number(e.target.value) })
          }
        />
        <label htmlFor={`opacity-${id}`} className={styles.styleGridLabel}>
          opacity
        </label>
        <input
          id={`opacity-${id}`}
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={style.opacity ?? 1}
          data-testid={`layer-opacity-${id}`}
          onChange={(e) => updateStyle(id, { opacity: Number(e.target.value) })}
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
      className={joinClass(styles.row, styles.rowAnnotation)}
    >
      <button
        type="button"
        className={joinClass(
          styles.iconButton,
          visible && styles.iconButtonPressed,
        )}
        aria-label={visible ? "Hide annotation" : "Show annotation"}
        aria-pressed={visible}
        data-testid={`layer-visibility-${id}`}
        onClick={() => setVisibility(id, !visible)}
      >
        {visible ? <IconEye /> : <IconEyeSlash />}
      </button>
      <span
        aria-label="Annotation"
        className={joinClass(styles.kindBadge, styles.kindBadgeAnnotation)}
      >
        A
      </span>
      <span className={styles.label}>{label}</span>
      <button
        type="button"
        className={styles.iconButton}
        aria-label="Move annotation up"
        data-testid={`layer-up-${id}`}
        onClick={() => reorder(id, order - 1)}
      >
        <IconChevronUp />
      </button>
      <button
        type="button"
        className={styles.iconButton}
        aria-label="Move annotation down"
        data-testid={`layer-down-${id}`}
        onClick={() => reorder(id, order + 1)}
      >
        <IconChevronDown />
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

  // Phase 6 A5: StylePanel is a floating dialog opened from a per-row button.
  // We keep the open layer id local to LayerPanel so closing one row's editor
  // doesn't affect any other row. `null` = closed.
  const [stylePanelLayerId, setStylePanelLayerId] = React.useState<
    string | null
  >(null);

  // Phase 6 A14b — aria-live announcements on layer-visibility toggles. We
  // wrap setVisibility (not the underlying store) so the registry stays
  // pure; the panel is the surface that decides when to announce.
  const announce = useAnnounce();
  const announcingSetVisibility = React.useCallback(
    (id: string, visible: boolean) => {
      // Resolve label from the latest entries snapshot — looking it up here
      // (not closing over the row's stale value) keeps the message accurate
      // if a label rename races with the toggle.
      const entry = entries.find((e) => e.id === id);
      const name = entry?.label ?? id;
      setVisibility(id, visible);
      announce(`Layer "${name}" ${visible ? "shown" : "hidden"}`);
    },
    [entries, setVisibility, announce],
  );

  const mutators: Mutators = {
    setVisibility: announcingSetVisibility,
    reorder,
    updateStyle,
    openStyle: setStylePanelLayerId,
  };

  const dataLayers = entries
    .filter((e): e is DataLayerEntry => e.kind === "data")
    .slice()
    .sort(byOrder);
  const annotations = entries
    .filter((e): e is AnnotationLayerEntry => e.kind === "annotation")
    .slice()
    .sort(byOrder);

  return (
    <div data-testid="layer-panel-body" className={styles.body}>
      <section aria-label="Data Layers" className={styles.section}>
        <h3 className={styles.heading}>Data Layers</h3>
        {dataLayers.length === 0 ? (
          <p className={styles.empty}>(none — drop a GeoJSON file)</p>
        ) : (
          dataLayers.map((entry) => (
            <DataLayerRow key={entry.id} entry={entry} mutators={mutators} />
          ))
        )}
      </section>
      <section aria-label="Annotations" className={styles.section}>
        <h3 className={styles.heading}>Annotations</h3>
        {annotations.length === 0 ? (
          <p className={styles.empty}>(none — draw with Excalidraw tools)</p>
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
      {stylePanelLayerId && (
        <StylePanel
          layerId={stylePanelLayerId}
          onClose={() => setStylePanelLayerId(null)}
        />
      )}
    </div>
  );
}
