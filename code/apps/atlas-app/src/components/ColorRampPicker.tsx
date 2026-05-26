// SPDX-License-Identifier: AGPL-3.0-only
// Phase 6 Wave 1b A5 — ColorRampPicker.
//
// Renders a static row of preset color ramps as horizontal gradient swatches.
// Click selects; the active ramp is reported back via `onChange` as an array
// of hex colors of length `stops`.
//
// Static palette table inline (no chroma / d3-color dependency — Phase 6 plan
// constraint). Names align with ColorBrewer / viridis conventions; the actual
// hex values are sampled at 5 stops.
//
// Plan: docs/superpowers/plans/2026-05-15-atlasdraw-phase-6-amended-scope.md §A5
// Conventions: .claude/skills/atlasdraw-ui-conventions/SKILL.md

import React from "react";

import styles from "../styles/StylePanel.module.css";

// --- palette table -----------------------------------------------------------
// Six ramps × five stops. Sampled from ColorBrewer (sequential + qualitative)
// and the Matplotlib viridis / magma sequential families. Length-5 baseline;
// for `stops !== 5`, we re-sample by linear index (simple nearest-neighbor —
// enough for preview purposes, exact stops are picked by the StylePanel).

const RAMPS: Record<string, string[]> = {
  Viridis: ["#440154", "#3b528b", "#21918c", "#5ec962", "#fde725"],
  Magma: ["#000004", "#51127c", "#b73779", "#fc8961", "#fcfdbf"],
  Set2: ["#66c2a5", "#fc8d62", "#8da0cb", "#e78ac3", "#a6d854"],
  Pastel1: ["#fbb4ae", "#b3cde3", "#ccebc5", "#decbe4", "#fed9a6"],
  OrRd: ["#fef0d9", "#fdcc8a", "#fc8d59", "#e34a33", "#b30000"],
  YlGnBu: ["#ffffcc", "#a1dab4", "#41b6c4", "#2c7fb8", "#253494"],
};

const RAMP_NAMES = Object.keys(RAMPS);

/**
 * Re-sample a 5-stop ramp to an arbitrary stop count via linear index
 * mapping. For stops <= 5 we pick evenly across the source; for stops > 5 we
 * stretch (preview-quality — caller chooses real stops elsewhere).
 */
function resample(ramp: string[], stops: number): string[] {
  if (stops === ramp.length) {
    return ramp.slice();
  }
  if (stops <= 1) {
    return [ramp[0]];
  }
  const out: string[] = [];
  for (let i = 0; i < stops; i++) {
    const t = i / (stops - 1);
    const idx = Math.round(t * (ramp.length - 1));
    out.push(ramp[idx]);
  }
  return out;
}

function gradientCss(colors: string[]): string {
  if (colors.length === 0) {
    return "transparent";
  }
  if (colors.length === 1) {
    return colors[0];
  }
  return `linear-gradient(to right, ${colors.join(", ")})`;
}

export type ColorRampPickerProps = {
  /** Currently selected ramp as a list of hex colors. May be empty. */
  value: string[];
  /** Called with the selected ramp's colors (length = `stops`). */
  onChange: (colors: string[]) => void;
  /** Number of color stops to emit. Default 5. */
  stops?: number;
};

export function ColorRampPicker({
  value,
  onChange,
  stops = 5,
}: ColorRampPickerProps) {
  // Compare by joined string — cheap enough at this scale.
  const valueKey = value.join("|");

  return (
    <div className={styles.rampRow} data-testid="color-ramp-picker">
      {RAMP_NAMES.map((name) => {
        const colors = resample(RAMPS[name], stops);
        const isActive = colors.join("|") === valueKey;
        return (
          <button
            key={name}
            type="button"
            aria-label={`Color ramp ${name}`}
            aria-pressed={isActive}
            title={name}
            data-testid={`ramp-${name}`}
            className={[
              styles.rampSwatch,
              isActive ? styles.rampSwatchActive : "",
            ]
              .filter(Boolean)
              .join(" ")}
            style={{ background: gradientCss(colors) }}
            onClick={() => onChange(colors)}
          />
        );
      })}
    </div>
  );
}
