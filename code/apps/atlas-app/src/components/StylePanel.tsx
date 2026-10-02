// SPDX-License-Identifier: AGPL-3.0-only
// StylePanel.
//
// Per-layer style editor: three tabs (Single color / Categorical / Graduated)
// that author either a flat `style.color`/`fillColor` or a data-driven
// `style.expression` (compiled by @atlasdraw/basemap's compileLayer).
//
// Reads the layer + first-feature properties via the existing
// open document (`useDocument`). Writes through a `restyle` command — never
// mutates `style` directly.
//
// It is the symbology section of LayerPanel's expanded layer card, in normal
// flow. Do not make it a positioned dialog again: inside the ~294px
// `overflow:hidden` sidebar body, under a stacking context above itself, a
// floating box is clipped and occluded at once.
//
// So it has no dialog chrome: no Modal, no Escape-to-close, no × button,
// no `role="dialog"`, and no "Layer not found" branch — the card only renders
// inside a row whose entry it just read, so `layerId` cannot dangle.
//
// Conventions: .claude/skills/atlasdraw-ui-conventions/SKILL.md

import { useMemo, useState } from "react";

import { LABEL_SIZE_MAX, LABEL_SIZE_MIN } from "@atlasdraw/basemap";

import type {
  FilterOp,
  FilterStyle,
  LabelStyle,
  StyleExpression,
} from "@atlasdraw/basemap";

import { dispatch, useDocument } from "../state/document";
import { useOverlayReport } from "../hooks/useMapOverlays";

import styles from "../styles/StylePanel.module.css";

import { ColorRampPicker } from "./ColorRampPicker";

import type { DataLayerEntry, LayerStyle } from "../state/document";

// ---- stop-computation helpers (inline: no stats dependency) -----------------

/**
 * Linear stops: N evenly-spaced breakpoints from min..max.
 */
function linearStops(values: number[], count: number): number[] {
  if (values.length === 0 || count < 2) {
    return [];
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) {
    return [min];
  }
  const step = (max - min) / (count - 1);
  return Array.from({ length: count }, (_, i) => +(min + step * i).toFixed(6));
}

/**
 * Quantile stops: N breakpoints at i/(count-1) quantiles of the sorted data.
 * For count=5 this yields 0%, 25%, 50%, 75%, 100% — i.e. min, Q1, median, Q3, max.
 */
function quantileStops(values: number[], count: number): number[] {
  if (values.length === 0 || count < 2) {
    return [];
  }
  const sorted = values.slice().sort((a, b) => a - b);
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const idx = Math.min(
      sorted.length - 1,
      Math.round(t * (sorted.length - 1)),
    );
    out.push(+sorted[idx].toFixed(6));
  }
  // Skewed data repeats a value. An interpolation needs strictly ascending
  // stops, so a repeat is dropped, and the ramp gets fewer stops.
  return out.filter((v, i) => i === 0 || v !== out[i - 1]);
}

/**
 * Equal-interval stops: identical to linear; included as a named alias because
 * the plan's StylePanel exposes three method choices, and the caller may want
 * to record the *author's intent* in `style.expression.method` even when the
 * numeric breakpoints would be identical to linear.
 */
function equalIntervalStops(values: number[], count: number): number[] {
  return linearStops(values, count);
}

function computeStops(
  method: "linear" | "quantile" | "equal-interval",
  values: number[],
  count: number,
): number[] {
  switch (method) {
    case "quantile":
      return quantileStops(values, count);
    case "equal-interval":
      return equalIntervalStops(values, count);
    case "linear":
    default:
      return linearStops(values, count);
  }
}

// ---- props ------------------------------------------------------------------

export type StylePanelProps = {
  layerId: string;
};

type Tab = "single" | "categorical" | "graduated";

const DEFAULT_RAMP = ["#fef0d9", "#fdcc8a", "#fc8d59", "#e34a33", "#b30000"];

// ---- component --------------------------------------------------------------

export function StylePanel({ layerId }: StylePanelProps) {
  const overlays = useDocument((s) => s.overlays);
  const entry = overlays.find(
    (e): e is DataLayerEntry => e.kind === "data" && e.id === layerId,
  );
  const fc = useDocument((s) => s.featureCollections[layerId]);
  // MapLibre's objection to the last style the user tried to apply.
  const [rejection, setRejection] = useState<string | null>(null);
  // A style MapLibre rejects is refused by the document, which keeps the
  // style the map draws; the user sees why.
  const restyle = (patch: Partial<LayerStyle>) => {
    if (!entry) {
      return;
    }
    const result = dispatch({ type: "restyle", id: layerId, patch });
    setRejection(result.ok ? null : result.reason);
  };

  // Initial tab: derive from the existing style.expression (if any).
  const initialTab: Tab = entry?.style.expression
    ? entry.style.expression.kind === "categorical"
      ? "categorical"
      : "graduated"
    : "single";
  const [tab, setTab] = useState<Tab>(initialTab);

  // Introspect feature properties from the first feature. Empty list when the
  // FC is missing (e.g. a layer entry exists but has no FC — a
  // converted annotation, perhaps). Categorical accepts string|number; graduated
  // is filtered to numeric only.
  const { allProps, numericProps } = useMemo(() => {
    const first = fc?.features[0];
    const props = first?.properties ?? {};
    const all = Object.keys(props);
    const numeric = all.filter((k) => typeof props[k] === "number");
    return { allProps: all, numericProps: numeric };
  }, [fc]);

  // A layer card only renders StylePanel for an entry it has in hand, so a
  // missing entry means the store changed between the card's render and this
  // one. Render nothing rather than a "not found" placeholder inside a card
  // that is about to unmount anyway.
  if (!entry) {
    return null;
  }

  return (
    <div className={styles.panel} data-testid="style-panel">
      <div
        role="tablist"
        aria-label="Symbology mode"
        className={styles.tabStrip}
      >
        <TabButton
          tab="single"
          active={tab}
          onClick={setTab}
          label="Single color"
        />
        <TabButton
          tab="categorical"
          active={tab}
          onClick={setTab}
          label="Categorical"
        />
        <TabButton
          tab="graduated"
          active={tab}
          onClick={setTab}
          label="Graduated"
        />
      </div>

      <div className={styles.body}>
        {tab === "single" && (
          <SingleColorTab
            entry={entry}
            onApply={(hex) =>
              // A line has no fill: its colour is the stroke.
              restyle({
                ...(entry.geometryKind === "line"
                  ? { strokeColor: hex }
                  : { fillColor: hex }),
                expression: undefined,
              })
            }
          />
        )}
        {tab === "categorical" && (
          <CategoricalTab
            entry={entry}
            allProps={allProps}
            onApply={(expr) => restyle({ expression: expr })}
          />
        )}
        {tab === "graduated" && (
          <GraduatedTab
            entry={entry}
            numericProps={numericProps}
            fcValues={(prop: string) =>
              (fc?.features ?? [])
                .map((f) => f.properties?.[prop])
                .filter((v): v is number => typeof v === "number")
            }
            onApply={(expr) => restyle({ expression: expr })}
          />
        )}
      </div>
      <LabelSection
        entry={entry}
        allProps={allProps}
        onApply={(label) => restyle({ label })}
      />
      <FilterSection
        entry={entry}
        allProps={allProps}
        onApply={(filter) => restyle({ filter })}
      />
      {rejection && (
        <p role="alert" className={styles.error} data-testid="style-rejected">
          {`Not applied: ${rejection}`}
        </p>
      )}
    </div>
  );
}

// ---- labels -----------------------------------------------------------------

const DEFAULT_LABEL_SIZE = 12;

/**
 * Labels from one property. They need the basemap's glyphs: when the map
 * says the basemap has none, the section says so. The label is still saved,
 * and shows when the user picks a basemap with labels.
 */
function LabelSection({
  entry,
  allProps,
  onApply,
}: {
  entry: DataLayerEntry;
  allProps: string[];
  onApply: (label: LabelStyle | undefined) => void;
}) {
  const existing = entry.style.label;
  const [property, setProperty] = useState(
    existing?.property ?? allProps[0] ?? "",
  );
  const [size, setSize] = useState(existing?.size ?? DEFAULT_LABEL_SIZE);
  const [halo, setHalo] = useState(existing?.halo ?? true);
  const labelFont = useOverlayReport((s) => s.labelFont);

  return (
    <section
      className={styles.section}
      aria-label="Labels"
      data-testid="style-labels"
    >
      <h5 className={styles.sectionHeading}>Labels</h5>
      {labelFont === null && (
        <p className={styles.note} data-testid="label-no-glyphs">
          This basemap has no font for labels. Labels show on a basemap that has
          place names, for example Light or Dark.
        </p>
      )}
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Property</span>
        <select
          value={property}
          data-testid="label-property"
          onChange={(e) => setProperty(e.target.value)}
        >
          {allProps.length === 0 && <option value="">(no properties)</option>}
          {allProps.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Size</span>
        <input
          type="number"
          min={LABEL_SIZE_MIN}
          max={LABEL_SIZE_MAX}
          value={size}
          data-testid="label-size"
          onChange={(e) => setSize(Number(e.target.value))}
        />
      </label>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Halo</span>
        <input
          type="checkbox"
          checked={halo}
          data-testid="label-halo"
          onChange={(e) => setHalo(e.target.checked)}
        />
      </label>
      <div className={styles.sectionActions}>
        {existing && (
          <button
            type="button"
            className={styles.secondaryBtn}
            data-testid="label-remove"
            onClick={() => onApply(undefined)}
          >
            Remove labels
          </button>
        )}
        <button
          type="button"
          className={styles.applyBtn}
          data-testid="label-apply"
          onClick={() => onApply({ property, size, halo })}
        >
          Apply
        </button>
      </div>
    </section>
  );
}

// ---- filter -----------------------------------------------------------------

/** The comparisons, in the order the menu shows them, with their signs. */
const FILTER_OPS: ReadonlyArray<{ op: FilterOp; sign: string }> = [
  { op: "==", sign: "=" },
  { op: "!=", sign: "≠" },
  { op: "<", sign: "<" },
  { op: ">", sign: ">" },
  { op: "contains", sign: "contains" },
];

/** Draw only the features whose property passes one comparison. */
function FilterSection({
  entry,
  allProps,
  onApply,
}: {
  entry: DataLayerEntry;
  allProps: string[];
  onApply: (filter: FilterStyle | undefined) => void;
}) {
  const existing = entry.style.filter;
  const [property, setProperty] = useState(
    existing?.property ?? allProps[0] ?? "",
  );
  const [op, setOp] = useState<FilterOp>(existing?.op ?? "==");
  const [value, setValue] = useState(existing?.value ?? "");

  return (
    <section
      className={styles.section}
      aria-label="Filter"
      data-testid="style-filter"
    >
      <h5 className={styles.sectionHeading}>Filter</h5>
      <p className={styles.note}>Show only the features that match.</p>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Property</span>
        <select
          value={property}
          data-testid="filter-property"
          onChange={(e) => setProperty(e.target.value)}
        >
          {allProps.length === 0 && <option value="">(no properties)</option>}
          {allProps.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Compare</span>
        <select
          value={op}
          data-testid="filter-op"
          onChange={(e) => setOp(e.target.value as FilterOp)}
        >
          {FILTER_OPS.map((o) => (
            <option key={o.op} value={o.op}>
              {o.sign}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Value</span>
        <input
          type="text"
          value={value}
          data-testid="filter-value"
          onChange={(e) => setValue(e.target.value)}
        />
      </label>
      <div className={styles.sectionActions}>
        {existing && (
          <button
            type="button"
            className={styles.secondaryBtn}
            data-testid="filter-remove"
            onClick={() => onApply(undefined)}
          >
            Remove filter
          </button>
        )}
        <button
          type="button"
          className={styles.applyBtn}
          data-testid="filter-apply"
          onClick={() => onApply({ property, op, value })}
        >
          Apply
        </button>
      </div>
    </section>
  );
}

// ---- tab strip --------------------------------------------------------------

function TabButton({
  tab,
  active,
  onClick,
  label,
}: {
  tab: Tab;
  active: Tab;
  onClick: (t: Tab) => void;
  label: string;
}) {
  const isActive = tab === active;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={isActive}
      data-testid={`style-tab-${tab}`}
      className={[styles.tab, isActive ? styles.tabActive : ""]
        .filter(Boolean)
        .join(" ")}
      onClick={() => onClick(tab)}
    >
      {label}
    </button>
  );
}

// ---- single-color tab -------------------------------------------------------

function SingleColorTab({
  entry,
  onApply,
}: {
  entry: DataLayerEntry;
  onApply: (hex: string) => void;
}) {
  const [hex, setHex] = useState<string>(
    (entry.geometryKind === "line"
      ? entry.style.strokeColor
      : entry.style.fillColor) ?? "#0aa",
  );
  return (
    <div className={styles.tabBody}>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Color</span>
        <input
          type="color"
          value={hex}
          data-testid="style-single-color"
          onChange={(e) => setHex(e.target.value)}
        />
      </label>
      <button
        type="button"
        className={styles.applyBtn}
        data-testid="style-single-apply"
        onClick={() => onApply(hex)}
      >
        Apply
      </button>
    </div>
  );
}

// ---- categorical tab --------------------------------------------------------

type CatStop = { value: string; color: string };

function CategoricalTab({
  entry,
  allProps,
  onApply,
}: {
  entry: DataLayerEntry;
  allProps: string[];
  onApply: (expr: StyleExpression) => void;
}) {
  const existing =
    entry.style.expression?.kind === "categorical"
      ? entry.style.expression
      : undefined;

  const [property, setProperty] = useState<string>(
    existing?.property ?? allProps[0] ?? "",
  );
  const [stopsState, setStopsState] = useState<CatStop[]>(
    existing
      ? existing.stops.map((s) => ({ value: String(s.value), color: s.color }))
      : [{ value: "", color: "#1971c2" }],
  );
  const [fallback, setFallback] = useState<string>(
    existing?.fallback ?? "#cccccc",
  );

  const updateStop = (idx: number, patch: Partial<CatStop>) => {
    setStopsState((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)),
    );
  };
  const addStop = () =>
    setStopsState((prev) => [...prev, { value: "", color: "#1971c2" }]);
  const removeStop = (idx: number) =>
    setStopsState((prev) => prev.filter((_, i) => i !== idx));

  const apply = () => {
    onApply({
      kind: "categorical",
      property,
      stops: stopsState.map((s) => ({ value: s.value, color: s.color })),
      fallback,
    });
  };

  return (
    <div className={styles.tabBody}>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Property</span>
        <select
          value={property}
          data-testid="cat-property"
          onChange={(e) => setProperty(e.target.value)}
        >
          {allProps.length === 0 && <option value="">(no properties)</option>}
          {allProps.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </label>
      <div className={styles.stopList} data-testid="cat-stop-list">
        {stopsState.map((s, idx) => (
          <div key={idx} className={styles.stopRow}>
            <input
              type="text"
              value={s.value}
              placeholder="value"
              data-testid={`cat-stop-value-${idx}`}
              onChange={(e) => updateStop(idx, { value: e.target.value })}
            />
            <input
              type="color"
              value={s.color}
              data-testid={`cat-stop-color-${idx}`}
              onChange={(e) => updateStop(idx, { color: e.target.value })}
            />
            <button
              type="button"
              aria-label="Remove stop"
              data-testid={`cat-stop-remove-${idx}`}
              onClick={() => removeStop(idx)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        className={styles.secondaryBtn}
        data-testid="cat-add-stop"
        onClick={addStop}
      >
        + Add stop
      </button>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Fallback</span>
        <input
          type="color"
          value={fallback}
          data-testid="cat-fallback"
          onChange={(e) => setFallback(e.target.value)}
        />
      </label>
      <button
        type="button"
        className={styles.applyBtn}
        data-testid="cat-apply"
        onClick={apply}
      >
        Apply
      </button>
    </div>
  );
}

// ---- graduated tab ----------------------------------------------------------

function GraduatedTab({
  entry,
  numericProps,
  fcValues,
  onApply,
}: {
  entry: DataLayerEntry;
  numericProps: string[];
  fcValues: (prop: string) => number[];
  onApply: (expr: StyleExpression) => void;
}) {
  const existing =
    entry.style.expression?.kind === "graduated"
      ? entry.style.expression
      : undefined;

  const [property, setProperty] = useState<string>(
    existing?.property ?? numericProps[0] ?? "",
  );
  const [method, setMethod] = useState<
    "linear" | "quantile" | "equal-interval"
  >(existing?.method ?? "linear");
  const [stopCount, setStopCount] = useState<number>(
    existing?.stops.length && existing.stops.length >= 3
      ? existing.stops.length
      : 5,
  );
  const [colors, setColors] = useState<string[]>(
    existing?.stops.map((s) => s.color) ?? DEFAULT_RAMP,
  );
  const [computedStops, setComputedStops] = useState<number[]>(
    existing?.stops.map((s) => s.stop) ?? [],
  );
  const [fallback, setFallback] = useState<string>(
    existing?.fallback ?? "#cccccc",
  );

  const compute = () => {
    if (!property) {
      return;
    }
    const values = fcValues(property);
    const next = computeStops(method, values, stopCount);
    setComputedStops(next);
    // Keep colors length aligned to stop count.
    if (colors.length !== next.length) {
      // Resample colors by linear index from current ramp.
      const ramp = colors.length > 0 ? colors : DEFAULT_RAMP;
      const resampled: string[] = [];
      for (let i = 0; i < next.length; i++) {
        const t = next.length <= 1 ? 0 : i / (next.length - 1);
        const idx = Math.round(t * (ramp.length - 1));
        resampled.push(ramp[idx]);
      }
      setColors(resampled);
    }
  };

  const apply = () => {
    const stops = computedStops.map((stop, i) => ({
      stop,
      color: colors[i] ?? colors[colors.length - 1] ?? "#000000",
    }));
    onApply({
      kind: "graduated",
      property,
      method,
      stops,
      fallback,
    });
  };

  return (
    <div className={styles.tabBody}>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Property</span>
        <select
          value={property}
          data-testid="grad-property"
          onChange={(e) => setProperty(e.target.value)}
        >
          {numericProps.length === 0 && (
            <option value="">(no numeric properties)</option>
          )}
          {numericProps.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Method</span>
        <select
          value={method}
          data-testid="grad-method"
          onChange={(e) =>
            setMethod(
              e.target.value as "linear" | "quantile" | "equal-interval",
            )
          }
        >
          <option value="linear">linear</option>
          <option value="quantile">quantile</option>
          <option value="equal-interval">equal-interval</option>
        </select>
      </label>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Stops</span>
        <input
          type="number"
          min={3}
          max={9}
          value={stopCount}
          data-testid="grad-stop-count"
          onChange={(e) =>
            setStopCount(Math.max(3, Math.min(9, Number(e.target.value) || 5)))
          }
        />
      </label>
      <ColorRampPicker value={colors} stops={stopCount} onChange={setColors} />
      <button
        type="button"
        className={styles.secondaryBtn}
        data-testid="grad-compute"
        onClick={compute}
      >
        Compute stops
      </button>
      {computedStops.length > 0 && (
        <div className={styles.stopPreview} data-testid="grad-preview">
          {computedStops.map((s, i) => (
            <div
              key={i}
              className={styles.previewSwatch}
              style={{ background: colors[i] ?? "#000" }}
              title={String(s)}
            >
              <span className={styles.previewLabel}>{s}</span>
            </div>
          ))}
        </div>
      )}
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Fallback</span>
        <input
          type="color"
          value={fallback}
          data-testid="grad-fallback"
          onChange={(e) => setFallback(e.target.value)}
        />
      </label>
      <button
        type="button"
        className={styles.applyBtn}
        data-testid="grad-apply"
        onClick={apply}
      >
        Apply
      </button>
    </div>
  );
}
