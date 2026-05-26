/**
 * StatusBar — ambient instrument readout for the map viewport.
 *
 * Thin footer bar (28px, z:10) showing current coordinates, zoom level,
 * and connection/save state. Subscribes to map move events for live
 * center/zoom; state indicators poll from Zustand stores.
 *
 * Design: drafting-room instrument panel — mono for data, quiet labels,
 * vellum base with a hairline top border. Always visible, never demanding.
 */

import React, { useEffect, useState } from "react";

import styles from "../styles/StatusBar.module.css";

import type maplibregl from "maplibre-gl";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtLng(lng: number): string {
  const abs = Math.abs(lng).toFixed(4);
  return lng < 0 ? `${abs}°W` : `${abs}°E`;
}

function fmtLat(lat: number): string {
  const abs = Math.abs(lat).toFixed(4);
  return lat < 0 ? `${abs}°S` : `${abs}°N`;
}

function fmtZoom(zoom: number): string {
  return zoom.toFixed(1);
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface StatusBarProps {
  map: maplibregl.Map | null;
}

// ---------------------------------------------------------------------------

export function StatusBar({ map }: StatusBarProps) {
  const [center, setCenter] = useState<{ lng: number; lat: number } | null>(
    null,
  );
  const [zoom, setZoom] = useState<number | null>(null);
  const [online, setOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );

  useEffect(() => {
    if (!map) {
      return;
    }

    const update = () => {
      const c = map.getCenter();
      setCenter({ lng: c.lng, lat: c.lat });
      setZoom(map.getZoom());
    };

    update(); // initial
    map.on("move", update);
    return () => {
      map.off("move", update);
    };
  }, [map]);

  // Online/offline detection — self-host-first offline is a key differentiator.
  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  return (
    <div className={styles.bar} data-testid="status-bar">
      <div className={styles.group}>
        <span
          className={[styles.dot, online ? styles.dotOk : styles.dotOff].join(
            " ",
          )}
          data-testid="status-bar-online-dot"
          aria-label={online ? "Online" : "Offline"}
          title={online ? "Online" : "Offline — working locally"}
        />
        {center ? (
          <span className={styles.coord} data-testid="status-bar-coords">
            {fmtLat(center.lat)}&ensp;{fmtLng(center.lng)}
          </span>
        ) : (
          <span className={styles.label}>--</span>
        )}
      </div>

      <div className={styles.group}>
        {zoom !== null && (
          <span className={styles.zoom} data-testid="status-bar-zoom">
            {fmtZoom(zoom)}×
          </span>
        )}
        <span
          className={[styles.dot, styles.dotOk].join(" ")}
          data-testid="status-bar-save-dot"
          aria-label="Saved"
          title="All changes saved"
        />
      </div>
    </div>
  );
}
