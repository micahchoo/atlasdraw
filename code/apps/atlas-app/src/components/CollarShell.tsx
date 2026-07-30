// SPDX-License-Identifier: AGPL-3.0-only
//
// CollarShell — the printed map-sheet frame ("The Collar", variant A: full
// collar). Chrome is a frame, not floating islands: head bar → flush tool
// strip → lon graticule → [lat graticule | map plate | sheet-panel icon
// rail] → bottom marginalia. Nothing floats over the map at rest.
//
// Visual spec: prototypes/collar-shell/index.html (?variant=a); direction
// record: .interface-design/system.md § "Shell Direction — The Collar".
//
// This component is layout + frame only. The plate content (MapLibre +
// Excalidraw stack) comes in as `children`; the tool strip / tabs / foot
// rows are slots the editor fills in.

import React from "react";

import styles from "../styles/CollarShell.module.css";

import { GraticuleTicks } from "./GraticuleTicks";

import type maplibregl from "maplibre-gl";

interface CollarShellProps {
  /** Live map — drives the graticule tick labels. */
  map: maplibregl.Map | null;
  /**
   * Sheet (document) name shown next to the wordmark. A slot, not a string —
   * the editor fills it with `<SheetNameField>`, which owns the click-to-edit
   * state. The shell stays layout-only (see the file header).
   */
  sheetName: React.ReactNode;
  /** Head-bar slot, right-aligned (search, menu trigger). */
  headExtras?: React.ReactNode;
  /**
   * Callback ref for the tool-strip host element. Excalidraw's toolbar
   * portals here in collar mode (see the `collarToolbarTarget` prop on the
   * vendored `<Excalidraw>`).
   */
  toolStripHostRef?: (el: HTMLDivElement | null) => void;
  /** Callback ref for the head-bar main-menu host (`collarMenuTarget`). */
  menuHostRef?: (el: HTMLDivElement | null) => void;
  /**
   * Right frame column — the sheet-panel icon rail (`<SheetRail>`), the only
   * trigger surface for the right sidebar in collar mode.
   */
  tabs?: React.ReactNode;
  /** Bottom marginalia row (scale bar, coords, datum, attribution). */
  foot?: React.ReactNode;
  /**
   * Width in px that the open sheet panel reserves on the plate's right edge —
   * 0 when the panel is closed or floating.
   *
   * Published as the `--ad-sheet-panel-inset` custom property on the shell so
   * both surfaces that measure the *map* rather than the *plate* can subtract
   * it: the MapLibre layer (`MapEditor.module.css`) and the longitude graticule
   * (`.lonCell` below), whose 5 ticks are laid out west→east across the map's
   * width. Inherited, so `MapEditor` never re-states the number.
   */
  panelInset?: number;
  /** The map plate: MapLibre + Excalidraw stack, confined to the neatline. */
  children: React.ReactNode;
}

export function CollarShell({
  map,
  sheetName,
  headExtras,
  toolStripHostRef,
  menuHostRef,
  tabs,
  foot,
  panelInset = 0,
  children,
}: CollarShellProps) {
  return (
    <div
      className={styles.shell}
      style={{ ["--ad-sheet-panel-inset" as string]: `${panelInset}px` }}
      data-testid="collar-shell"
      data-panel-inset={panelInset}
    >
      <header className={styles.head} data-testid="collar-head">
        <span className={styles.wordmark}>ATLASDRAW</span>
        {/* Separator is frame decoration, so it stays with the frame — and
          stays put when the slot swaps its label for an input. */}
        <span className={styles.sheetSeparator} aria-hidden="true">
          ·
        </span>
        {sheetName}
        <span className={styles.headSpacer} />
        {headExtras}
        <div className={styles.menuHost} ref={menuHostRef} />
      </header>

      <div className={styles.tools} data-testid="collar-tools">
        <div className={styles.toolStripHost} ref={toolStripHostRef} />
        <span className={styles.toolHint} aria-hidden="true">
          <kbd>⌘K</kbd> anything
        </span>
      </div>

      <div className={styles.lonCell}>
        <GraticuleTicks map={map} axis="lon" />
      </div>
      <div className={styles.latCell}>
        <GraticuleTicks map={map} axis="lat" />
      </div>

      <div className={styles.plate} data-testid="collar-plate">
        {children}
      </div>

      <nav className={styles.tabs} data-testid="collar-tabs">
        {tabs}
      </nav>

      <footer className={styles.foot} data-testid="collar-foot">
        {foot}
      </footer>
    </div>
  );
}
