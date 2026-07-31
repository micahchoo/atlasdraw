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
// Sheet-panel step 4 + 6 (2026-07-30) — a data layer is now a CARD that
// expands in place. Three things follow from that, each with a reason:
//
//   * One card open at a time (accordion). A vertical column is zero-sum;
//     letting every card stay open is the QGIS legend explosion, and the
//     design doc names it as this design's weakest point (§4).
//   * The filter field appears at >= FILTER_THRESHOLD data layers, not
//     before. QGIS force-collapses at >= 10 nodes and ArcGIS Online reveals
//     layer search at >= 10 — two products picked the same number
//     independently, which is about as strong as UI precedent gets.
//   * Symbology is StylePanel, inline (see StylePanel.tsx's header for what
//     the move cost). It is no longer a floating dialog clipped by this
//     panel's own overflow.
//
// Annotation entries are NOT data layers: no style, no FeatureCollection, no
// attributes. They keep the plain row they always had rather than a card with
// four empty sections.
//
// Plan: docs/superpowers/plans/2026-05-03-atlasdraw-phase-2-tools-data-layers.md §T12
// Design: PLANS/ATLASDRAW_SIDEBAR_DESIGN.md §2, §4
// Conventions: .claude/skills/atlasdraw-ui-conventions/SKILL.md

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { getBasemap, listBasemaps } from "@atlasdraw/basemap";

import type { BasemapConfig } from "@atlasdraw/basemap";

import { useLayerRegistry } from "../hooks/useLayerRegistry";
import { useOpenThreadCount } from "../hooks/useOpenThreadCount";
import { useBasemapStore } from "../state/basemap";
import { useMapInstanceStore } from "../state/mapInstance";
import { useDataLayerFCStore } from "../state/useDataLayerFCStore";
import { fitMapToLayer } from "../lib/fitMapToContent";

import styles from "../styles/LayerPanel.module.css";

import { useAnnounce } from "./AriaAnnouncer";
import { CommentsPanelHost } from "./CommentsPanelHost";
import { StylePanel } from "./StylePanel";

import type {
  LayerRegistryEntry,
  AnnotationLayerEntry,
  DataLayerEntry,
  LayerStyle,
} from "../state/layerRegistry";
import type { FeatureCollection } from "geojson";

/**
 * Data-layer count at which the filter field appears. QGIS force-collapses its
 * legend at >= 10 nodes; ArcGIS Online only surfaces layer search at >= 10.
 * Showing it earlier spends a row of a 294px panel on a control that would
 * never beat scanning three labels.
 */
const FILTER_THRESHOLD = 10;

/** Attribute-preview size: rows sampled, and columns that fit the panel width. */
const ATTR_PREVIEW_ROWS = 3;
const ATTR_PREVIEW_COLS = 4;

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

/** Disclosure caret: points right when collapsed, down when expanded. */
function IconCaret({ open }: { open: boolean }) {
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
      {open ? (
        <polyline points="3,6 8,11 13,6" />
      ) : (
        <polyline points="6,3 11,8 6,13" />
      )}
    </svg>
  );
}

function IconDots() {
  return (
    <svg
      className={styles.icon}
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      <circle cx="3.5" cy="8" r="1.3" />
      <circle cx="8" cy="8" r="1.3" />
      <circle cx="12.5" cy="8" r="1.3" />
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
// Provenance + attribute helpers (pure — no store, no DOM)
// ---------------------------------------------------------------------------

/**
 * GeoJSON geometry type of the layer, as the user would name it ("Polygon").
 *
 * Deliberately the raw GeoJSON name and not `inferGeometryType`'s MapLibre
 * kind ("fill"): provenance answers "what did I import?", and nobody imports a
 * fill. Reads the first feature that actually has geometry — a leading
 * `geometry: null` feature is legal and would otherwise report "unknown" for a
 * layer full of polygons.
 */
function geometryTypeOf(fc: FeatureCollection | undefined): string {
  const withGeometry = fc?.features.find((f) => f.geometry);
  return withGeometry?.geometry?.type ?? "unknown";
}

/**
 * Property keys to show in the attribute preview, capped at ATTR_PREVIEW_COLS.
 * Unions the keys across the sampled rows rather than trusting feature 0 —
 * GeoJSON does not require a uniform property set, and a sparse first feature
 * would otherwise render an empty table over a perfectly good layer.
 */
function previewColumns(features: FeatureCollection["features"]): string[] {
  const keys: string[] = [];
  for (const f of features) {
    for (const k of Object.keys(f.properties ?? {})) {
      if (!keys.includes(k)) {
        keys.push(k);
      }
    }
  }
  return keys.slice(0, ATTR_PREVIEW_COLS);
}

/** Render a property value compactly; objects/arrays collapse to JSON. */
function formatCell(value: unknown): string {
  if (value === null || value === undefined) {
    return "—";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

// ---------------------------------------------------------------------------
// Row / card infrastructure
// ---------------------------------------------------------------------------

type Mutators = {
  setVisibility: (id: string, visible: boolean) => void;
  /** `newOrder` is the target index within the row's own section (= its kind). */
  reorder: (id: string, newOrder: number) => void;
  updateStyle: (id: string, patch: Partial<LayerStyle>) => void;
};

/** The three actions the design doc calls out as missing (§2). */
type LayerActions = {
  rename: (id: string, label: string) => void;
  remove: (id: string) => void;
  zoomTo: (id: string) => void;
};

interface LayerRowProps {
  entry: LayerRegistryEntry;
  mutators: Mutators;
  allIds: string[];
}

/**
 * Wraps a layer row with HTML5 drag-and-drop reorder support.
 *
 * `draggable` sits on the grip and nowhere else. The browser looks *up* the
 * tree for a draggable ancestor when a press starts, so a draggable row makes
 * every control inside the card a drag source too: since Step 4 the row expands
 * into a card, and reaching for the colour input or sweeping across the rename
 * box began a layer reorder with the whole expanded card as the drag image.
 * One drag source, and it is the thing that looks like one.
 *
 * Drop target stays the row — you aim at a row, not at its grip. Dropping above
 * the midpoint sends the dragged item before the target; below sends it after.
 *
 * Keyboard reorder via up/down arrow buttons is preserved as a fallback.
 */
function SortableRow({
  entry,
  mutators,
  allIds,
  children,
  body,
  expanded = false,
}: LayerRowProps & {
  /** Header content — shares one flex line with the grip and reorder arrows. */
  children: React.ReactNode;
  /**
   * Expanded card body. A sibling BELOW the header line, not a child of it, so
   * it gets the row's full width instead of the ~150px left over between the
   * grip and the reorder arrows.
   */
  body?: React.ReactNode;
  /**
   * This row is the open one. Two consequences, both of them "keep the card you
   * just opened usable in a list that now scrolls":
   *
   *   - the header line sticks to the top of the scroll port while the card's
   *     own body scrolls past it, so the layer's name is still on screen when
   *     you reach Apply. The 25-layer prototype's specific complaint was the
   *     name scrolling off the top.
   *   - opening scrolls the header into view, because the ninth card of 25
   *     opens below the fold and the useful part of it is further down still.
   */
  expanded?: boolean;
}) {
  const { id } = entry;
  // Position inside this section's list. `allIds` is the one section's ids, and
  // the store's reorder is kind-scoped, so this index is the only coordinate
  // system in play — reading entry.order directly would be the same number
  // today, but this keeps the row honest about what it can address.
  //
  // Note `allIds` stays the UNFILTERED section list even when the filter field
  // is hiding rows: reorder addresses real stack positions, and handing it
  // filtered indices is exactly the class of bug P3 fixed.
  const index = allIds.indexOf(id);
  const rowRef = useRef<HTMLDivElement>(null);
  const rowTopRef = useRef<HTMLDivElement>(null);
  const [dragOverPos, setDragOverPos] = useState<"above" | "below" | null>(
    null,
  );

  // Reveal on open, not on every render: `expanded` is the dependency, so
  // re-renders from a style edit inside the open card do not yank the scroll
  // position back. `block: "nearest"` because a card that is already fully in
  // view must not move at all — the first three cards of three should feel
  // like nothing happened.
  //
  // Guarded because jsdom does not implement scrollIntoView; the panel's tests
  // render the real component and would throw on the first expand.
  useEffect(() => {
    const el = rowRef.current;
    if (!expanded || !el || typeof el.scrollIntoView !== "function") {
      return;
    }
    el.scrollIntoView({ block: "nearest" });
  }, [expanded]);

  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", id);
      // The header line, not `e.currentTarget` and not the row. The grip alone
      // is a 12px smudge you cannot aim with, and the row is the whole expanded
      // card. The header is what carries the layer's name, which is the thing
      // you are moving. Guarded because jsdom implements neither setDragImage
      // nor a laid-out ref, and the panel's tests fire real drag events.
      const image = rowTopRef.current;
      if (image && typeof e.dataTransfer.setDragImage === "function") {
        e.dataTransfer.setDragImage(image, 0, 0);
      }
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

      // Insertion point in the list as it looks *now*: above the target means
      // taking the target's slot, below means the slot after it. The store
      // pulls the dragged row out first, which shifts everything past it down
      // one — so an insertion point beyond the dragged row loses one.
      const insertBefore =
        dragOverPos === "above" ? targetIndex : targetIndex + 1;
      const nextIndex =
        insertBefore > draggedIndex ? insertBefore - 1 : insertBefore;

      mutators.reorder(draggedId, nextIndex);
    },
    [id, allIds, mutators, dragOverPos],
  );

  // Bounds are the section's, not the registry's: a row can only move within
  // its own kind, so the top data layer and the top annotation are both
  // "first". The up/down buttons are kept for keyboard-only users and as a
  // discoverable alternative to drag.
  const isFirst = index <= 0;
  const isLast = allIds.length <= 1 || index === allIds.length - 1;

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
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div
        ref={rowTopRef}
        className={joinClass(styles.rowTop, expanded && styles.rowTopSticky)}
        data-sticky={expanded ? "" : undefined}
      >
        <span
          className={styles.dragHandle}
          aria-label={`Drag to reorder ${entry.label}`}
          data-testid={`layer-drag-${id}`}
          role="button"
          tabIndex={0}
          draggable
          onDragStart={handleDragStart}
        >
          <IconGripVertical />
        </span>
        {children}
        {/* Stacked as one 32px-tall control cluster rather than two 32px
            squares. Adding the disclosure caret and the ⋯ trigger put nine
            controls in a 302px row; side-by-side arrows left the label about
            40px, which turns "parcels_2026.geojson" into "parc…". Same
            buttons, same keyboard path, same bounds — half the width. */}
        <div className={styles.reorderStack}>
          <button
            type="button"
            className={styles.reorderBtn}
            aria-label={`Move ${entry.label} up`}
            data-testid={`layer-up-${id}`}
            disabled={isFirst}
            onClick={() => mutators.reorder(id, index - 1)}
          >
            <IconChevronUp />
          </button>
          <button
            type="button"
            className={styles.reorderBtn}
            aria-label={`Move ${entry.label} down`}
            data-testid={`layer-down-${id}`}
            disabled={isLast}
            onClick={() => mutators.reorder(id, index + 1)}
          >
            <IconChevronDown />
          </button>
        </div>
      </div>
      {body}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Layer name — click to edit
// ---------------------------------------------------------------------------

/**
 * The input half of LayerNameField, split out so the draft seeds from `initial`
 * in a useState initializer at mount. Editing is a mount, cancelling is an
 * unmount, and the "current label changed underneath the open editor" case
 * can't arise — which an effect that copied `label` into the draft would have
 * to handle.
 *
 * Interaction contract is SheetNameField's, deliberately: the collar head bar
 * and the layer list should not disagree about what renaming feels like.
 */
function LayerNameInput({
  id,
  initial,
  onCommit,
  onCancel,
}: {
  id: string;
  initial: string;
  onCommit: (label: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);

  const focusAndSelect = useCallback((el: HTMLInputElement | null) => {
    el?.focus();
    el?.select();
  }, []);

  const commit = () => {
    const next = draft.trim();
    // Blank is a cancel, not a reset: clearing the box is how you retype.
    if (next !== "" && next !== initial) {
      onCommit(next);
    }
    onCancel();
  };

  return (
    <input
      type="text"
      ref={focusAndSelect}
      className={styles.renameInput}
      aria-label={`Rename ${initial}`}
      data-testid={`layer-rename-input-${id}`}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          // The panel sits inside the Excalidraw sidebar; a bubbling Escape
          // closes it, and losing the whole panel is not what cancelling a
          // rename should cost.
          e.stopPropagation();
          onCancel();
        }
      }}
    />
  );
}

/**
 * A layer's name: a button that opens an inline editor, or the editor itself.
 *
 * `editing` is the parent's, not this component's, because a data layer can
 * also enter the state from the ⋯ menu and from the expanded card's Rename
 * button — three doors into one editor.
 */
function LayerNameField({
  id,
  label,
  editing,
  onEditingChange,
  onCommit,
}: {
  id: string;
  label: string;
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
  onCommit: (label: string) => void;
}) {
  if (editing) {
    return (
      <LayerNameInput
        id={id}
        initial={label}
        onCommit={onCommit}
        onCancel={() => onEditingChange(false)}
      />
    );
  }

  return (
    <button
      type="button"
      className={joinClass(styles.label, styles.labelButton)}
      data-testid={`layer-name-${id}`}
      title={`${label} — click to rename`}
      onClick={() => onEditingChange(true)}
    >
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// The ⋯ overflow menu
// ---------------------------------------------------------------------------

/**
 * Per-layer overflow menu. Reachable whether or not the card is expanded, so
 * "zoom to this layer" — the universal gesture after an import — never costs a
 * disclosure click first.
 *
 * Delete is two-step inside the menu. The registry has no undo, an imported
 * layer can represent a real parsing session, and a single mis-click sits 4px
 * from Rename.
 */
function OverflowMenu({
  entry,
  actions,
  onStartRename,
}: {
  entry: DataLayerEntry;
  actions: LayerActions;
  onStartRename: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemsRef = useRef<Array<HTMLButtonElement | null>>([]);
  const [focusIndex, setFocusIndex] = useState(0);

  const close = useCallback(() => {
    setOpen(false);
    setConfirmingDelete(false);
  }, []);

  /**
   * The menu's items, as data. Rendering them from a list rather than as three
   * hand-written buttons is what makes the roving tabindex below one loop
   * instead of one `tabIndex` expression per button — and the two views have
   * different lengths, which is precisely the thing hand-written indices get
   * wrong.
   */
  const items = confirmingDelete
    ? [
        {
          key: "cancel",
          testid: `layer-delete-cancel-${entry.id}`,
          label: "Cancel",
          danger: false,
          onSelect: () => setConfirmingDelete(false),
        },
        {
          key: "confirm",
          testid: `layer-delete-confirm-${entry.id}`,
          label: "Delete layer",
          danger: true,
          onSelect: () => {
            close();
            actions.remove(entry.id);
          },
        },
      ]
    : [
        {
          key: "zoom",
          testid: `layer-zoom-${entry.id}`,
          label: "Zoom to layer",
          danger: false,
          onSelect: () => {
            close();
            actions.zoomTo(entry.id);
          },
        },
        {
          key: "rename",
          testid: `layer-rename-${entry.id}`,
          label: "Rename…",
          danger: false,
          onSelect: () => {
            close();
            onStartRename();
          },
        },
        {
          key: "delete",
          testid: `layer-delete-${entry.id}`,
          label: "Delete…",
          danger: true,
          onSelect: () => setConfirmingDelete(true),
        },
      ];

  // Focus the first item on open, and again when the confirm step swaps the
  // list out from under it. Without the second half, stepping into "Delete…"
  // leaves focus on a button that no longer exists and the confirm step is
  // keyboard-unreachable — which would make the two-step guard a keyboard trap
  // rather than a safety net.
  //
  // `items.length` rather than `items` as the dependency: the array is rebuilt
  // every render, so the identity changes on every keystroke and would re-steal
  // focus mid-navigation. Its LENGTH changes exactly when the view swaps.
  useEffect(() => {
    if (!open) {
      return;
    }
    setFocusIndex(0);
    itemsRef.current[0]?.focus();
  }, [open, items.length]);

  const moveFocus = useCallback((index: number) => {
    setFocusIndex(index);
    itemsRef.current[index]?.focus();
  }, []);

  // Same arrow/Home/End contract the rail got in Step 2 — one component over,
  // and the gap that FU-6 is about.
  const onItemKeyDown = (event: React.KeyboardEvent, index: number) => {
    const last = items.length - 1;
    switch (event.key) {
      case "ArrowDown":
        moveFocus(index === last ? 0 : index + 1);
        break;
      case "ArrowUp":
        moveFocus(index === 0 ? last : index - 1);
        break;
      case "Home":
        moveFocus(0);
        break;
      case "End":
        moveFocus(last);
        break;
      default:
        // Escape, Tab, Enter and Space stay with the browser and with the
        // dismiss handler below.
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  // Dismiss on outside pointer-down and on Escape. Escape also returns focus
  // to the trigger — otherwise focus lands on <body> and a keyboard user has
  // to tab back through every row above.
  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) {
        close();
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close]);

  return (
    <div className={styles.menuWrap} ref={wrapRef}>
      <button
        type="button"
        ref={triggerRef}
        className={styles.iconButton}
        aria-label={`Actions for ${entry.label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid={`layer-menu-${entry.id}`}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <IconDots />
      </button>
      {open && (
        <div
          role="menu"
          aria-label={`Actions for ${entry.label}`}
          className={styles.menu}
          data-testid={`layer-menu-list-${entry.id}`}
        >
          {confirmingDelete && (
            <p className={styles.menuConfirmText}>
              Delete “{entry.label}”? This cannot be undone.
            </p>
          )}
          {items.map((item, index) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              ref={(el) => {
                itemsRef.current[index] = el;
              }}
              className={joinClass(
                styles.menuItem,
                item.danger && styles.menuItemDanger,
              )}
              data-testid={item.testid}
              tabIndex={index === focusIndex ? 0 : -1}
              onKeyDown={(e) => onItemKeyDown(e, index)}
              onClick={item.onSelect}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Expanded-card sections
// ---------------------------------------------------------------------------

/**
 * Provenance — always visible while the card is expanded.
 *
 * This is Dr. Ana's reproducibility need (PRD §3 persona C). Before this it
 * lived only in a 4-second import toast, which didn't even carry the drop
 * count, and `label` stops answering "which file?" the first time anyone
 * renames a layer.
 */
function ProvenanceSection({
  entry,
  fc,
}: {
  entry: DataLayerEntry;
  fc: FeatureCollection | undefined;
}) {
  const { provenance } = entry;
  return (
    <dl
      className={styles.provenance}
      data-testid={`layer-provenance-${entry.id}`}
    >
      <dt className={styles.metaLabel}>Geometry</dt>
      <dd className={styles.metaValue}>{geometryTypeOf(fc)}</dd>
      <dt className={styles.metaLabel}>Source</dt>
      <dd className={styles.metaValue}>
        {provenance?.sourceFile ?? "unknown"}
      </dd>
      {/* "N dropped", not "N of M": `droppedCount` mixes two kinds of loss —
          CSV rows that never became features (outside featureCount) and
          features with null geometry (inside it) — so no single M is honest.
          The design doc's own line is "Polygon · parcels.geojson · 2 dropped". */}
      <dt className={styles.metaLabel}>Dropped</dt>
      <dd className={styles.metaValue}>
        {provenance
          ? provenance.droppedCount === 0
            ? "none"
            : `${provenance.droppedCount}`
          : "unknown"}
      </dd>
    </dl>
  );
}

/** Fill / stroke / width / opacity, applied live, plus StylePanel's ramps. */
function SymbologySection({
  entry,
  updateStyle,
}: {
  entry: DataLayerEntry;
  updateStyle: (id: string, patch: Partial<LayerStyle>) => void;
}) {
  const { id, style } = entry;
  return (
    <div data-testid={`layer-symbology-${id}`}>
      <div className={styles.styleGrid}>
        <label htmlFor={`fill-${id}`} className={styles.styleGridLabel}>
          Fill
        </label>
        <input
          id={`fill-${id}`}
          type="color"
          value={style.fillColor ?? "#000000"}
          data-testid={`layer-fill-${id}`}
          onChange={(e) => updateStyle(id, { fillColor: e.target.value })}
        />
        <label htmlFor={`stroke-${id}`} className={styles.styleGridLabel}>
          Stroke
        </label>
        <input
          id={`stroke-${id}`}
          type="color"
          value={style.strokeColor ?? "#000000"}
          data-testid={`layer-stroke-${id}`}
          onChange={(e) => updateStyle(id, { strokeColor: e.target.value })}
        />
        <label htmlFor={`stroke-width-${id}`} className={styles.styleGridLabel}>
          Width
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
          Opacity
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
      {/* Was a floating dialog clipped by this panel's own overflow; now the
          rest of this section. See StylePanel.tsx's header. */}
      <StylePanel layerId={id} />
    </div>
  );
}

/** First few features' properties — "is this the data I meant to import?" */
function AttributePreview({
  entry,
  fc,
}: {
  entry: DataLayerEntry;
  fc: FeatureCollection | undefined;
}) {
  const rows = useMemo(
    () => (fc?.features ?? []).slice(0, ATTR_PREVIEW_ROWS),
    [fc],
  );
  const columns = useMemo(() => previewColumns(rows), [rows]);

  if (rows.length === 0) {
    return (
      <p className={styles.attrHint} data-testid={`layer-attrs-${entry.id}`}>
        No features to preview.
      </p>
    );
  }
  if (columns.length === 0) {
    return (
      <p className={styles.attrHint} data-testid={`layer-attrs-${entry.id}`}>
        {`Showing ${rows.length} of ${entry.featureCount} — these features carry no properties.`}
      </p>
    );
  }

  return (
    <div className={styles.attrTable} data-testid={`layer-attrs-${entry.id}`}>
      <table>
        <caption className={styles.srOnly}>
          {`Attribute preview for ${entry.label}`}
        </caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c} scope="col">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((f, i) => (
            <tr key={i}>
              {columns.map((c) => (
                <td key={c} title={formatCell(f.properties?.[c])}>
                  {formatCell(f.properties?.[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className={styles.attrHint}>
        {`Showing ${rows.length} of ${entry.featureCount}`}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The data layer card
// ---------------------------------------------------------------------------

function DataLayerCard({
  entry,
  mutators,
  actions,
  allIds,
  expanded,
  onToggleExpanded,
}: {
  entry: DataLayerEntry;
  mutators: Mutators;
  actions: LayerActions;
  allIds: string[];
  expanded: boolean;
  onToggleExpanded: () => void;
}) {
  const { setVisibility, updateStyle } = mutators;
  const { id, label, visible, featureCount } = entry;
  const fc = useDataLayerFCStore((s) => s.fcs[id]);
  const [renaming, setRenaming] = useState(false);
  const bodyId = `layer-card-body-${id}`;

  return (
    <SortableRow
      entry={entry}
      mutators={mutators}
      allIds={allIds}
      expanded={expanded}
      body={
        expanded ? (
          <div
            className={styles.detail}
            id={bodyId}
            data-testid={`layer-detail-${id}`}
          >
            <ProvenanceSection entry={entry} fc={fc} />

            <h4 className={styles.detailHeading}>Symbology</h4>
            <SymbologySection entry={entry} updateStyle={updateStyle} />

            <h4 className={styles.detailHeading}>Attributes</h4>
            <AttributePreview entry={entry} fc={fc} />

            <div className={styles.detailActions}>
              <button
                type="button"
                className={styles.detailBtn}
                data-testid={`layer-zoom-inline-${id}`}
                onClick={() => actions.zoomTo(id)}
              >
                Zoom to layer
              </button>
              <button
                type="button"
                className={styles.detailBtn}
                data-testid={`layer-rename-inline-${id}`}
                onClick={() => setRenaming(true)}
              >
                Rename
              </button>
            </div>
          </div>
        ) : null
      }
    >
      <div className={styles.rowHeader} data-testid={`layer-row-header-${id}`}>
        {/* The disclosure is the button, not the whole row: a row-wide click
            target would swallow clicks meant for the eye toggle and the ⋯
            trigger nested inside it, and a div-with-onClick is not reachable
            by keyboard at all. */}
        <button
          type="button"
          className={styles.disclosure}
          aria-expanded={expanded}
          aria-controls={bodyId}
          aria-label={`${expanded ? "Collapse" : "Expand"} ${label}`}
          data-testid={`layer-disclosure-${id}`}
          onClick={onToggleExpanded}
        >
          <IconCaret open={expanded} />
        </button>
        <span
          aria-label="Data layer"
          className={joinClass(styles.kindBadge, styles.kindBadgeData)}
        >
          D
        </span>
        <LayerNameField
          id={id}
          label={label}
          editing={renaming}
          onEditingChange={setRenaming}
          onCommit={(next) => actions.rename(id, next)}
        />
        <span
          className={styles.featureCount}
          title={`${featureCount} features`}
        >
          {featureCount}
        </span>
        <button
          type="button"
          className={joinClass(
            styles.iconButton,
            visible && styles.iconButtonPressed,
          )}
          aria-label={visible ? `Hide ${label}` : `Show ${label}`}
          aria-pressed={visible}
          data-testid={`layer-visibility-${id}`}
          onClick={() => setVisibility(id, !visible)}
        >
          {visible ? <IconEye /> : <IconEyeSlash />}
        </button>
        <OverflowMenu
          entry={entry}
          actions={actions}
          onStartRename={() => setRenaming(true)}
        />
      </div>
    </SortableRow>
  );
}

function AnnotationLayerRow({
  entry,
  mutators,
  actions,
  allIds,
}: {
  entry: AnnotationLayerEntry;
  mutators: Mutators;
  actions: LayerActions;
  allIds: string[];
}) {
  const { setVisibility } = mutators;
  const { id, label, visible } = entry;
  const [renaming, setRenaming] = useState(false);

  // An annotation has no style, no FeatureCollection and no attributes, so it
  // gets a row rather than a card — four empty sections would be worse than
  // none. TODO(T14-adjacent): registry-only visibility flip lands here today.
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
        <LayerNameField
          id={id}
          label={label}
          editing={renaming}
          onEditingChange={setRenaming}
          onCommit={(next) => actions.rename(id, next)}
        />
      </div>
    </SortableRow>
  );
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Threads section — Step 5 (2026-07-30)
//
// The demoted CommentsPanel. It used to be its own sidebar tab; comments are a
// mode now (rail toggle + `C`, threads anchored on the map). What the tab was
// genuinely good at — "read every thread in order, resolve the stale ones" —
// is Marcus's review pass in the PRD, and that survives here, one level down,
// in the same Sheet scope as Basemap / Data Layers / Annotations.
//
// Collapsed by default, deliberately: it is the review surface, not the
// default one, and an always-open chronological list is exactly the 90%-empty
// column the tab was. The disclosure carries the open-thread count so the
// section still tells you there is something to read while closed.
// ---------------------------------------------------------------------------

function ThreadsSection() {
  const [open, setOpen] = useState(false);
  const openThreads = useOpenThreadCount();

  return (
    <section aria-label="Threads" className={styles.section}>
      <h3 className={styles.heading}>
        <button
          type="button"
          className={styles.threadsDisclosure}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          data-testid="threads-disclosure"
        >
          <span aria-hidden="true">{open ? "▾" : "▸"}</span>
          <span>Threads</span>
          {openThreads > 0 && (
            <span className={styles.threadsCount}>{openThreads} open</span>
          )}
        </button>
      </h3>
      {open && <CommentsPanelHost />}
    </section>
  );
}

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
  const {
    entries,
    setVisibility,
    reorder,
    updateStyle,
    remove,
    // The user-typed-label path. Not updateAnnotationLabel, which is the
    // generator's — going through that one would leave the rename open to
    // being overwritten by the next scene change. See layerRegistry.ts.
    renameLayer,
  } = useLayerRegistry();

  // Accordion: at most one card open. See the header note — multi-open is the
  // unbounded-growth failure mode this design is most exposed to.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

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
  };

  const actions: LayerActions = {
    rename: (id, label) => {
      renameLayer(id, label);
      announce(`Layer renamed to "${label}"`);
    },
    remove: (id) => {
      const name = entries.find((e) => e.id === id)?.label ?? id;
      // Collapse first: a card left "expanded" by id would re-open the next
      // layer that happens to reuse the slot.
      setExpandedId((cur) => (cur === id ? null : cur));
      remove(id);
      announce(`Layer "${name}" deleted`);
    },
    zoomTo: (id) => {
      const name = entries.find((e) => e.id === id)?.label ?? id;
      const map = useMapInstanceStore.getState().map;
      const fc = useDataLayerFCStore.getState().fcs[id];
      // Read both through getState() rather than subscribing: the panel does
      // not render differently because a map exists, and subscribing to every
      // FC would re-render all 25 cards on any import.
      if (fitMapToLayer(map, fc)) {
        announce(`Zoomed to "${name}"`);
      } else {
        announce(`"${name}" has no geometry to zoom to`);
      }
    },
  };

  const dataLayers = entries
    .filter((e): e is DataLayerEntry => e.kind === "data")
    .slice()
    .sort(byOrder);
  const annotations = entries
    .filter((e): e is AnnotationLayerEntry => e.kind === "annotation")
    .slice()
    .sort(byOrder);

  // Unfiltered — reorder indices address the real stack, not the visible
  // subset (see SortableRow).
  const dataLayerIds = dataLayers.map((e) => e.id);
  const annotationIds = annotations.map((e) => e.id);

  const showFilter = dataLayers.length >= FILTER_THRESHOLD;
  const needle = filter.trim().toLowerCase();
  const visibleDataLayers =
    showFilter && needle
      ? dataLayers.filter((e) => e.label.toLowerCase().includes(needle))
      : dataLayers;

  return (
    <div data-testid="layer-panel-body" className={styles.body}>
      <section aria-label="Data Layers" className={styles.section}>
        <h3 className={styles.heading}>Data Layers</h3>
        {showFilter && (
          <div className={styles.filterRow}>
            <label htmlFor="layer-filter" className={styles.srOnly}>
              Filter layers by name
            </label>
            <input
              id="layer-filter"
              type="search"
              className={styles.filterInput}
              placeholder={`Filter ${dataLayers.length} layers…`}
              data-testid="layer-filter"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
        )}
        {dataLayers.length === 0 ? (
          <p className={styles.empty}>(none — drop a GeoJSON file)</p>
        ) : visibleDataLayers.length === 0 ? (
          <p className={styles.empty} data-testid="layer-filter-no-match">
            {`No layer matches “${filter.trim()}”`}
          </p>
        ) : (
          visibleDataLayers.map((entry) => (
            <DataLayerCard
              key={entry.id}
              entry={entry}
              mutators={mutators}
              actions={actions}
              allIds={dataLayerIds}
              expanded={expandedId === entry.id}
              onToggleExpanded={() =>
                setExpandedId((cur) => (cur === entry.id ? null : entry.id))
              }
            />
          ))
        )}
      </section>
      <ThreadsSection />
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
              actions={actions}
              allIds={annotationIds}
            />
          ))
        )}
      </section>
      <BasemapSection />
    </div>
  );
}
