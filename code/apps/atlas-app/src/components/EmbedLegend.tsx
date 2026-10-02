// SPDX-License-Identifier: AGPL-3.0-only
//
// EmbedLegend — the key of an embedded map (legend=1).
//
// It lists what the PDF's legend lists (lib/legend.ts): the visible layers
// that have something in view, each with its colour. It reads the view again
// each time the map settles (`idle`), so it follows the reader's pans and
// zooms. A <details> element, open at first, so a reader on a small screen
// can close it over the map.

import { useEffect, useState } from "react";

import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw";

import { exportLegendEntries, type LegendMapSurface } from "../lib/legend";
import { annotationRows } from "../state/annotations";
import { useDocument } from "../state/document";
import styles from "../styles/EmbedView.module.css";

import type { LayerLegendEntry } from "../lib/print-pdf";

export type LegendMap = LegendMapSurface & {
  on(type: "idle", listener: () => void): unknown;
  off(type: "idle", listener: () => void): unknown;
};

export function EmbedLegend({
  map,
  api,
}: {
  map: LegendMap | null;
  api: ExcalidrawImperativeAPI | null;
}) {
  const overlays = useDocument((s) => s.overlays);
  const world = useDocument((s) => s.world);
  const [entries, setEntries] = useState<LayerLegendEntry[]>([]);

  useEffect(() => {
    if (!map || !api) {
      return;
    }
    let last = "";
    const update = () => {
      const next = exportLegendEntries(
        [...annotationRows(api.getSceneElements(), world), ...overlays],
        map,
        api,
      );
      // `idle` follows every frame that settles; a render per idle is waste.
      const key = JSON.stringify(next);
      if (key !== last) {
        last = key;
        setEntries(next);
      }
    };
    update();
    map.on("idle", update);
    return () => {
      map.off("idle", update);
    };
  }, [map, api, overlays, world]);

  if (entries.length === 0) {
    return null;
  }
  return (
    <details className={styles.legend} open data-testid="embed-legend">
      <summary className={styles.legendTitle}>Legend</summary>
      <ul className={styles.legendList}>
        {entries.map((e) => (
          <li key={e.id} className={styles.legendRow}>
            <span
              className={styles.legendSwatch}
              // The layer's own colour: a runtime value.
              style={{ background: e.color }}
              aria-hidden="true"
            />
            {e.name}
          </li>
        ))}
      </ul>
    </details>
  );
}
