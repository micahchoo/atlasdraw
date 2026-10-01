// SPDX-License-Identifier: AGPL-3.0-only
//
// CursorOverlay — where the other people in the room point. A peer's cursor
// is a place on Earth (room presence), drawn at map.project of it, so it
// stays on the same spot whatever either viewer's camera does. Redrawn on
// every map move.
//
// Conventions: .claude/skills/atlasdraw-ui-conventions/SKILL.md

import React, { useEffect, useReducer } from "react";

import styles from "../styles/CursorOverlay.module.css";

import type { Peer } from "../state/room";
import type * as maplibregl from "maplibre-gl";

export interface CursorOverlayProps {
  map: Pick<maplibregl.Map, "project" | "on" | "off"> | null;
  peers: readonly Peer[];
}

/** One dot and name per peer whose pointer is over the map. */
export function CursorOverlay({ map, peers }: CursorOverlayProps) {
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!map) {
      return;
    }
    map.on("move", redraw);
    return () => {
      map.off("move", redraw);
    };
  }, [map]);

  return (
    <svg className={styles.overlay} data-testid="cursor-overlay">
      {map &&
        peers.map((peer) => {
          if (!peer.cursor) {
            return null;
          }
          const p = map.project([peer.cursor.lng, peer.cursor.lat]);
          return (
            <g
              key={peer.clientId}
              data-testid={`cursor-${peer.clientId}`}
              transform={`translate(${p.x} ${p.y})`}
            >
              <circle r={4} fill={peer.user.color} />
              <text
                y={-10}
                fill={peer.user.color}
                fontSize="11"
                fontFamily="system-ui, sans-serif"
                textAnchor="middle"
              >
                {peer.user.name}
              </text>
            </g>
          );
        })}
    </svg>
  );
}
