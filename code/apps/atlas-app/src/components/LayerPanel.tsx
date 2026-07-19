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

import React, { useCallback, useRef, useState } from "react";

import { getBasemap, listBasemaps } from "@atlasdraw/basemap";

import type { BasemapConfig } from "@atlasdraw/basemap";

import { useLayerRegistry } from "../hooks/useLayerRegistry";
import { useBasemapStore } from "../state/basemap";

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

function IconGripVertical() {
  return (
    <svg
      className={styles.icon}
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      <circle cx="5" cy="3" r="1.2" />
      <circle cx="11" cy="3" r="1.2" />
      <circle cx="5" cy="8" r="1.2" />
      <circle cx="11" cy="8" r="1.2" />
      <circle cx="5" cy="13" r="1.2" />
      <circle cx="11" cy="13" r="1.2" />
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

interface LayerRowProps {
  entry: LayerRegistryEntry;
  mutators: Mutators;
  allIds: string[];
}

/**
 * Wraps a layer row with HTML5 drag-and-drop reorder support.
 * The drag handle (grip icon) initiates the drag. Drop target is the row
 * itself — dropping above the midpoint sends the dragged item before the
 * target; below the midpoint sends it after.
 *
 * Keyboard reorder via up/down arrow buttons is preserved as a fallback.
 */
function SortableRow({
  entry,
  mutators,
  allIds,
  children,
}: LayerRowProps & { children: React.ReactNode }) {
  const { id, order } = entry;
  const rowRef = useRef<HTMLDivElement>(null);
  const [dragOverPos, setDragOverPos] = useState<"above" | "below" | null>(
    null,
  );

  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", id);
      e.dataTransfer.setDragImage(e.currentTarget as HTMLElement, 0, 0);
    },
    [id],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    setDragOverPos(e.clientY < midY ? "above" : "below");
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOverPos(null);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOverPos(null);
      const draggedId = e.dataTransfer.getData("text/plain");
      if (!draggedId || draggedId === id) {
        return;
      }

      const draggedIndex = allIds.indexOf(draggedId);
      const targetIndex = allIds.indexOf(id);
      if (draggedIndex === -1 || targetIndex === -1) {
        return;
      }

      const newPosition =
        dragOverPos === "above" ? Math.max(0, targetIndex - 1) : targetIndex;
      // If the dragged item was above the target, the splice in the store
      // already accounts for removal — pass the target position directly.
      // But we need to send the position *after* the dragged item is removed.
      // Since we're using the *visible* allIds list, calculate the adjusted pos.
      const adjustedPos =
        draggedIndex < targetIndex && dragOverPos === "above"
          ? targetIndex - 1
          : draggedIndex < targetIndex
          ? targetIndex
          : newPosition;

      mutators.reorder(draggedId, adjustedPos);
    },
    [id, allIds, mutators, dragOverPos],
  );

  // With our store's splice-based reorder, any entry can be moved anywhere.
  // The old up/down buttons are kept for keyboard-only users and as a
  // discoverable alternative to drag.
  const isFirst = order === 0;
  const isLast = allIds.length <= 1 || order === allIds.length - 1;

  const rowClass = joinClass(
    styles.row,
    dragOverPos === "above" && styles.dragOverAbove,
    dragOverPos === "below" && styles.dragOverBelow,
  );

  return (
    <div
      ref={rowRef}
      data-testid={`layer-row-${id}`}
      className={rowClass}
      draggable
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <span
        className={styles.dragHandle}
        aria-label={`Drag to reorder ${entry.label}`}
        data-testid={`layer-drag-${id}`}
        role="button"
        tabIndex={0}
      >
        <IconGripVertical />
      </span>
      {children}
      <button
        type="button"
        className={styles.iconButton}
        aria-label="Move layer up"
        data-testid={`layer-up-${id}`}
        disabled={isFirst}
        onClick={() => mutators.reorder(id, order - 1)}
      >
        <IconChevronUp />
      </button>
      <button
        type="button"
        className={styles.iconButton}
        aria-label="Move layer down"
        data-testid={`layer-down-${id}`}
        disabled={isLast}
        onClick={() => mutators.reorder(id, order + 1)}
      >
        <IconChevronDown />
      </button>
    </div>
  );
}

function DataLayerRow({
  entry,
  mutators,
  allIds,
}: {
  entry: DataLayerEntry;
  mutators: Mutators;
  allIds: string[];
}) {
  const { setVisibility, updateStyle, openStyle } = mutators;
  const { id, label, visible, featureCount, style } = entry;
  const [expanded, setExpanded] = React.useState(false);

  return (
    <SortableRow entry={entry} mutators={mutators} allIds={allIds}>
      <div
        className={styles.rowHeader}
        onClick={() => setExpanded((p) => !p)}
        style={{ cursor: "pointer" }}
        data-testid={`layer-row-header-${id}`}
      >
        <button
          type="button"
          className={joinClass(
            styles.iconButton,
            visible && styles.iconButtonPressed,
          )}
          aria-label={visible ? "Hide layer" : "Show layer"}
          aria-pressed={visible}
          data-testid={`layer-visibility-${id}`}
          onClick={(e) => {
            e.stopPropagation();
            setVisibility(id, !visible);
          }}
        >
          {visible ? <IconEye /> : <IconEyeSlash />}
        </button>
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
          aria-label="Open style editor"
          data-testid={`layer-style-${id}`}
          onClick={(e) => {
            e.stopPropagation();
            openStyle(id);
          }}
          title="Style editor"
        >
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
        <span
          style={{
            marginLeft: "auto",
            fontSize: 10,
            color: "var(--ad-ink-tertiary)",
            transform: expanded ? "rotate(180deg)" : "none",
          }}
        >
          {(IconChevronDown as unknown as string) ? "▾" : "▸"}
        </span>
      </div>

      {/* Inline style controls (always visible, compact) */}
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

      {/* Detail accordion — expands on row click */}
      {expanded && (
        <div className={styles.detail} data-testid={`layer-detail-${id}`}>
          <div className={styles.detailMeta}>
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>Features</span>
              <span className={styles.metaValue}>{featureCount}</span>
            </div>
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>Fill</span>
              <span className={styles.metaValue}>{style.fillColor ?? "—"}</span>
            </div>
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>Stroke</span>
              <span className={styles.metaValue}>
                {style.strokeColor ?? "—"}{" "}
                {style.strokeWidth != null ? `${style.strokeWidth}px` : ""}
              </span>
            </div>
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>Opacity</span>
              <span className={styles.metaValue}>
                {style.opacity != null
                  ? `${Math.round(style.opacity * 100)}%`
                  : "100%"}
              </span>
            </div>
          </div>
          <div className={styles.detailActions}>
            <button
              type="button"
              className={styles.detailBtn}
              onClick={() => openStyle(id)}
              data-testid={`layer-detail-style-${id}`}
            >
              Full style editor
            </button>
          </div>
          <p className={styles.attrHint}>
            Attribute table preview will appear here when the data source is
            connected. FeatureCollection metadata is available at the MapLibre
            source level.
          </p>
        </div>
      )}
    </SortableRow>
  );
}

function AnnotationLayerRow({
  entry,
  mutators,
  allIds,
}: {
  entry: AnnotationLayerEntry;
  mutators: Mutators;
  allIds: string[];
}) {
  const { setVisibility } = mutators;
  const { id, label, visible } = entry;

  // TODO(T14-adjacent): registry-only visibility flip lands here today.
  // Mutating the actual Excalidraw element via excalidrawAPI.updateScene
  // is deferred until Wave 2c — see plan §844.
  return (
    <SortableRow entry={entry} mutators={mutators} allIds={allIds}>
      <div className={joinClass(styles.rowAnnotation)}>
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
      </div>
    </SortableRow>
  );
}

// ---------------------------------------------------------------------------
// Basemap section — IA restructure (2026-07-18): the basemap IS a layer, the
// bottom of the stack, so it's managed here — not from the MainMenu (which
// previously held a "Basemap: …" item + standalone BasemapPickerDialog) and
// not only from the Settings tab. Reads/writes the shared basemap store;
// "Edit style" raises the store flag that mounts MaputnikDialog in MapEditor.
// ---------------------------------------------------------------------------

function BasemapSection() {
  const activeBasemapId = useBasemapStore((s) => s.activeBasemapId);
  const setActiveBasemapId = useBasemapStore((s) => s.setActiveBasemapId);
  const setStyleEditorOpen = useBasemapStore((s) => s.setStyleEditorOpen);
  const [pickerOpen, setPickerOpen] = useState(false);

  const active = getBasemap(activeBasemapId);
  const basemaps = listBasemaps() as BasemapConfig[];

  const sourceBadge = (remote: boolean) => (
    <span
      className={remote ? styles.sourceBadgeRemote : styles.sourceBadgeLocal}
    >
      {remote ? "Remote" : "Local"}
    </span>
  );

  return (
    <section aria-label="Basemap" className={styles.section}>
      <h3 className={styles.heading}>Basemap</h3>
      <div className={styles.basemapRow} data-testid="layer-basemap-row">
        <button
          type="button"
          className={styles.basemapToggle}
          onClick={() => setPickerOpen((p) => !p)}
          aria-expanded={pickerOpen}
          data-testid="layer-basemap-toggle"
          title={pickerOpen ? "Hide basemap choices" : "Change basemap"}
        >
          <span className={styles.basemapName}>
            {active?.label ?? activeBasemapId}
          </span>
          {sourceBadge(active?.requiresRemote ?? false)}
        </button>
        <button
          type="button"
          className={styles.detailBtn}
          onClick={() => setStyleEditorOpen(true)}
          data-testid="layer-basemap-edit-style"
          title="Open the Maputnik style editor"
        >
          Edit style
        </button>
      </div>
      {pickerOpen && (
        <div className={styles.basemapOptions} role="listbox">
          {basemaps.map((b) => {
            const isActive = b.id === activeBasemapId;
            return (
              <button
                key={b.id}
                type="button"
                role="option"
                aria-selected={isActive}
                className={joinClass(
                  styles.basemapOption,
                  isActive && styles.basemapOptionActive,
                )}
                onClick={() => {
                  setActiveBasemapId(b.id);
                  setPickerOpen(false);
                }}
                data-testid={`basemap-option-${b.id}`}
              >
                <span className={styles.basemapName}>{b.label}</span>
                {sourceBadge(b.requiresRemote)}
              </button>
            );
          })}
        </div>
      )}
    </section>
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

  const dataLayerIds = dataLayers.map((e) => e.id);
  const annotationIds = annotations.map((e) => e.id);

  return (
    <div data-testid="layer-panel-body" className={styles.body}>
      <section aria-label="Data Layers" className={styles.section}>
        <h3 className={styles.heading}>Data Layers</h3>
        {dataLayers.length === 0 ? (
          <p className={styles.empty}>(none — drop a GeoJSON file)</p>
        ) : (
          dataLayers.map((entry) => (
            <DataLayerRow
              key={entry.id}
              entry={entry}
              mutators={mutators}
              allIds={dataLayerIds}
            />
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
              allIds={annotationIds}
            />
          ))
        )}
      </section>
      <BasemapSection />
      {stylePanelLayerId && (
        <StylePanel
          layerId={stylePanelLayerId}
          onClose={() => setStylePanelLayerId(null)}
        />
      )}
    </div>
  );
}
