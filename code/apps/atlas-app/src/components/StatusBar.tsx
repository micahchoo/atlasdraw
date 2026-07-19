/**
 * StatusBar — the Collar's bottom marginalia (map-sheet margin readouts).
 *
 * Printed in the collar foot row: segmented scale bar, live center
 * coordinates, datum/projection, basemap attribution, live zoom and the
 * 1:ratio representative fraction. Subscribes to map move events; the
 * scale/ratio math is ported from the collar-shell prototype
 * (prototypes/collar-shell/index.html: niceScale / update).
 *
 * Design: printed marginalia, not chrome — mono for data, quiet labels,
 * nothing floats over the plate.
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

/** Web-Mercator meters per CSS pixel at the given latitude/zoom. */
function metersPerPixel(lat: number, zoom: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}

/** Pick a round scale-bar length that renders between 64 and 150 px. */
const SCALE_STEPS = [
  50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000,
] as const;

function niceScale(mpp: number): { meters: number; px: number } {
  for (const meters of SCALE_STEPS) {
    const px = meters / mpp;
    if (px >= 64 && px <= 150) {
      return { meters, px };
    }
  }
  return { meters: 1000, px: 1000 / mpp };
}

function fmtScaleLabel(meters: number): string {
  return meters >= 1000 ? `${meters / 1000} km` : `${meters} m`;
}

/** 1:n representative fraction, assuming 96 dpi (3779.5 px/m). */
function fmtRatio(mpp: number): string {
  const ratio = Math.round(mpp * 3779.5);
  return ratio >= 1000
    ? `1:${(Math.round(ratio / 100) / 10).toLocaleString("en-US")}k`
    : `1:${ratio}`;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface StatusBarProps {
  map: maplibregl.Map | null;
}

interface Readout {
  center: { lng: number; lat: number };
  zoom: number;
  scalePx: number;
  scaleLabel: string;
  ratio: string;
}

// ---------------------------------------------------------------------------

export function StatusBar({ map }: StatusBarProps) {
  const [readout, setReadout] = useState<Readout | null>(null);
  const [online, setOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );

  useEffect(() => {
    if (!map) {
      return;
    }

    const update = () => {
      const c = map.getCenter();
      const zoom = map.getZoom();
      const mpp = metersPerPixel(c.lat, zoom);
      const { meters, px } = niceScale(mpp);
      setReadout({
        center: { lng: c.lng, lat: c.lat },
        zoom,
        scalePx: px,
        scaleLabel: fmtScaleLabel(meters),
        ratio: fmtRatio(mpp),
      });
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
      <span
        className={[styles.dot, online ? styles.dotOk : styles.dotOff].join(
          " ",
        )}
        data-testid="status-bar-online-dot"
        aria-label={online ? "Online" : "Offline"}
        title={online ? "Online" : "Offline — working locally"}
      />

      {readout ? (
        <>
          <span className={styles.scalebar} data-testid="status-bar-scalebar">
            <span
              className={styles.scalebarBar}
              style={{ width: readout.scalePx }}
              aria-hidden="true"
            >
              <i />
              <i />
              <i />
              <i />
            </span>
            <span className={styles.value}>{readout.scaleLabel}</span>
          </span>
          <span className={styles.coord} data-testid="status-bar-coords">
            {fmtLat(readout.center.lat)}&ensp;{fmtLng(readout.center.lng)}
          </span>
        </>
      ) : (
        <span className={styles.label}>--</span>
      )}

      <span className={styles.value} data-testid="status-bar-datum">
        WGS 84 · EPSG:3857
      </span>

      <span className={styles.spacer} />

      <span className={styles.attrib} data-testid="status-bar-attribution">
        basemap © OpenStreetMap
      </span>

      {readout && (
        <>
          <span className={styles.zoom} data-testid="status-bar-zoom">
            {fmtZoom(readout.zoom)}×
          </span>
          <span className={styles.value} data-testid="status-bar-ratio">
            {readout.ratio}
          </span>
        </>
      )}

      <span
        className={[styles.dot, styles.dotOk].join(" ")}
        data-testid="status-bar-save-dot"
        aria-label="Saved"
        title="All changes saved"
      />
    </div>
  );
}
