// SPDX-License-Identifier: MPL-2.0
//
// Measurement text: a length or an area in the unit that suits its size.
// Numbers below 100 keep three significant digits; above that, whole units.

export type UnitSystem = "metric" | "imperial";

const METERS_PER_FOOT = 0.3048;
const METERS_PER_MILE = 1609.344;
const SQ_METERS_PER_ACRE = 4046.856_422_4;
const SQ_METERS_PER_SQ_MILE = METERS_PER_MILE * METERS_PER_MILE;

/** `n` as `amount` shows it: whole above 100, else three significant digits. */
function rounded(n: number): number {
  return n >= 100 ? Math.round(n) : Number(n.toPrecision(3));
}

function amount(n: number): string {
  if (n === 0) {
    return "0";
  }
  return n >= 100
    ? Math.round(n).toLocaleString("en-US")
    : n.toLocaleString("en-US", { maximumSignificantDigits: 3 });
}

/**
 * True when `n` of the smaller unit shows as less than `limit`. A value that
 * rounds up to the limit takes the larger unit: "1 km", never "1,000 m".
 */
const below = (n: number, limit: number) => rounded(n) < limit;

/** A length in metres as text: m / km, or ft / mi. */
export function formatLength(meters: number, system: UnitSystem): string {
  if (system === "metric") {
    return below(meters, 1000)
      ? `${amount(meters)} m`
      : `${amount(meters / 1000)} km`;
  }
  const feet = meters / METERS_PER_FOOT;
  return below(feet, 1000)
    ? `${amount(feet)} ft`
    : `${amount(meters / METERS_PER_MILE)} mi`;
}

/** An area in square metres as text: m² / ha / km², or ft² / ac / mi². */
export function formatArea(sqMeters: number, system: UnitSystem): string {
  if (system === "metric") {
    if (below(sqMeters, 10_000)) {
      return `${amount(sqMeters)} m²`;
    }
    return below(sqMeters / 10_000, 100)
      ? `${amount(sqMeters / 10_000)} ha`
      : `${amount(sqMeters / 1_000_000)} km²`;
  }
  const acres = sqMeters / SQ_METERS_PER_ACRE;
  if (acres < 0.1) {
    return `${amount(sqMeters / (METERS_PER_FOOT * METERS_PER_FOOT))} ft²`;
  }
  return below(acres, 640)
    ? `${amount(acres)} ac`
    : `${amount(sqMeters / SQ_METERS_PER_SQ_MILE)} mi²`;
}

/** Imperial for a United States locale, metric for every other. */
export function unitSystemForLocale(locale: string): UnitSystem {
  let region: string | undefined;
  try {
    region = new Intl.Locale(locale).region;
  } catch {
    region = undefined;
  }
  return region === "US" ? "imperial" : "metric";
}
