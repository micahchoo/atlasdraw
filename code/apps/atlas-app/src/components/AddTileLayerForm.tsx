// SPDX-License-Identifier: AGPL-3.0-only
//
// AddTileLayerForm — "Add tile layer…" in the layer panel.
//
// Surface decision (atlasdraw-ui-conventions, Rule 0): adding a layer is
// layer management, so it is in the layer panel, inline, like the panel's
// other forms. No modal: the form has four fields.
//
// The form checks the URL template (lib/tileLayers#validateTileTemplate)
// before it adds anything, and shows the reason when it refuses one. The
// editor ships no tile URL and no key. The one preset is the USGS aerial
// imagery of the United States: public domain, no key, and a clear credit.
// It only fills in the form; nothing calls the USGS server until the user
// adds the layer. A build that turns remote basemaps off
// (VITE_ALLOW_REMOTE_BASEMAPS=false) does not show it.

import React, { useId, useState } from "react";

import { getAppConfig } from "../config/app-config";
import { validateTileTemplate } from "../lib/tileLayers";
import { dispatch } from "../state/document";

import styles from "../styles/AddTileLayerForm.module.css";

/**
 * USGS The National Map, imagery only. Read 2026-10-01 from the service's
 * own description (MapServer?f=pjson): 256 px tiles, levels 0–23, no token,
 * public-domain orthoimagery (NAIP for the conterminous United States).
 * ArcGIS tile URLs put the row before the column: {z}/{y}/{x}.
 */
export const USGS_IMAGERY = {
  label: "USGS aerial imagery (United States)",
  url: "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}",
  attribution: "USDA, USGS The National Map: Orthoimagery",
} as const;

/** The name a layer gets when the user gives none: its server. */
function hostOf(url: string): string {
  try {
    return new URL(url.replace(/\{[a-z]\}/g, "0")).host;
  } catch {
    return "Tile layer";
  }
}

export function AddTileLayerForm({ onDone }: { onDone: () => void }) {
  const id = useId();
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [attribution, setAttribution] = useState("");
  const [opacity, setOpacity] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const showPreset = getAppConfig().allowRemoteBasemaps;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const check = validateTileTemplate(url);
    if (!check.ok) {
      setError(check.reason);
      return;
    }
    dispatch({
      type: "add-tile-layer",
      id: `tl:${crypto.randomUUID()}`,
      label: name.trim() || hostOf(check.url),
      url: check.url,
      attribution: attribution.trim() || undefined,
      opacity,
    });
    onDone();
  };

  return (
    <form
      className={styles.form}
      onSubmit={submit}
      aria-label="Add tile layer"
      data-testid="tile-add-form"
      noValidate
    >
      <label className={styles.label} htmlFor={`${id}-url`}>
        Tile URL
      </label>
      <input
        id={`${id}-url`}
        className={styles.input}
        type="url"
        inputMode="url"
        spellCheck={false}
        placeholder="https://…/{z}/{x}/{y}.png"
        value={url}
        aria-invalid={error ? true : undefined}
        aria-describedby={`${id}-hint${error ? ` ${id}-error` : ""}`}
        data-testid="tile-url"
        onChange={(e) => {
          setUrl(e.target.value);
          setError(null);
        }}
        autoFocus
      />
      <p id={`${id}-hint`} className={styles.hint}>
        The URL must contain {"{z}"}, {"{x}"} and {"{y}"}. Use https.
      </p>
      {error && (
        <p
          id={`${id}-error`}
          role="alert"
          className={styles.error}
          data-testid="tile-add-error"
        >
          {error}
        </p>
      )}

      <label className={styles.label} htmlFor={`${id}-name`}>
        Name (optional)
      </label>
      <input
        id={`${id}-name`}
        className={styles.input}
        type="text"
        value={name}
        data-testid="tile-name"
        onChange={(e) => setName(e.target.value)}
      />

      <label className={styles.label} htmlFor={`${id}-attribution`}>
        Credit (optional)
      </label>
      <input
        id={`${id}-attribution`}
        className={styles.input}
        type="text"
        placeholder="© The tile provider"
        value={attribution}
        data-testid="tile-attribution"
        onChange={(e) => setAttribution(e.target.value)}
      />

      <label className={styles.label} htmlFor={`${id}-opacity`}>
        Opacity
      </label>
      <input
        id={`${id}-opacity`}
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={opacity}
        data-testid="tile-opacity"
        onChange={(e) => setOpacity(Number(e.target.value))}
      />

      {showPreset && (
        <button
          type="button"
          className={styles.preset}
          data-testid="tile-preset-usgs"
          onClick={() => {
            setUrl(USGS_IMAGERY.url);
            setAttribution(USGS_IMAGERY.attribution);
            setName(USGS_IMAGERY.label);
            setError(null);
          }}
        >
          Use {USGS_IMAGERY.label}
        </button>
      )}

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.button}
          data-testid="tile-add-cancel"
          onClick={onDone}
        >
          Cancel
        </button>
        <button
          type="submit"
          className={[styles.button, styles.buttonPrimary].join(" ")}
          data-testid="tile-add-submit"
        >
          Add layer
        </button>
      </div>
    </form>
  );
}
