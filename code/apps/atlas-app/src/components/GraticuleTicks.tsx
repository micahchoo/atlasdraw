// SPDX-License-Identifier: AGPL-3.0-only
//
// GraticuleTicks — live longitude/latitude tick labels printed in the Collar
// frame (shell direction: "The Collar", .interface-design/system.md).
//
// One component, two axes:
//   axis="lon" — horizontal row above the plate; labels west → east.
//   axis="lat" — vertical column left of the plate; labels north → south,
//                rotated like a printed quad's margin.
//
// Subscribes to the MapLibre `move` event and reads map.getBounds() — the
// same tick/format logic validated in the collar-shell prototype
// (prototypes/collar-shell/index.html, fillTicks/fmt).

import { useEffect, useState } from "react";

import styles from "../styles/GraticuleTicks.module.css";

import type maplibregl from "maplibre-gl";

// ---------------------------------------------------------------------------

function fmtTick(value: number, pos: string, neg: string): string {
  return `${Math.abs(value).toFixed(3)}°${value >= 0 ? pos : neg}`;
}

interface GraticuleTicksProps {
  map: maplibregl.Map | null;
  axis: "lon" | "lat";
  /** Number of tick labels; defaults match the prototype (5 lon / 4 lat). */
  count?: number;
}

export function GraticuleTicks({ map, axis, count }: GraticuleTicksProps) {
  const n = count ?? (axis === "lon" ? 5 : 4);
  const [labels, setLabels] = useState<string[]>(() =>
    new Array<string>(n).fill(""),
  );

  useEffect(() => {
    if (!map) {
      return;
    }
    const update = () => {
      const b = map.getBounds();
      const [from, to] =
        axis === "lon"
          ? [b.getWest(), b.getEast()]
          : [b.getNorth(), b.getSouth()];
      const [pos, neg] = axis === "lon" ? ["E", "W"] : ["N", "S"];
      setLabels(
        Array.from({ length: n }, (_, i) => {
          const t = n === 1 ? 0 : i / (n - 1);
          return fmtTick(from + (to - from) * t, pos, neg);
        }),
      );
    };
    update(); // initial
    map.on("move", update);
    return () => {
      map.off("move", update);
    };
  }, [map, axis, n]);

  return (
    <div
      className={axis === "lon" ? styles.lon : styles.lat}
      data-testid={`graticule-${axis}`}
      aria-hidden="true"
    >
      {labels.map((label, i) => (
        // Position in the row is the identity — labels change on every move.
        // eslint-disable-next-line react/no-array-index-key
        <span key={i}>{label}</span>
      ))}
    </div>
  );
}
