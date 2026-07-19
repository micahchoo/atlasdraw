// SPDX-License-Identifier: AGPL-3.0-only
//
// CollarShell — the printed map-sheet frame ("The Collar", variant A: full
// collar). Chrome is a frame, not floating islands: head bar → flush tool
// strip → lon graticule → [lat graticule | map plate | layer sheet-edge
// tabs] → bottom marginalia. Nothing floats over the map at rest.
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
  /** Sheet (document) name shown next to the wordmark. */
  sheetName: string;
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
  /** Right frame column — layer sheet-edge tabs (phase 3). */
  tabs?: React.ReactNode;
  /** Bottom marginalia row (scale bar, coords, datum, attribution). */
  foot?: React.ReactNode;
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
  children,
}: CollarShellProps) {
  return (
    <div className={styles.shell} data-testid="collar-shell">
      <header className={styles.head} data-testid="collar-head">
        <span className={styles.wordmark}>ATLASDRAW</span>
        <span className={styles.sheetName} data-testid="collar-sheet-name">
          {sheetName}
        </span>
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
