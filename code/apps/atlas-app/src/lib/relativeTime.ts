// SPDX-License-Identifier: AGPL-3.0-only
//
// "5 minutes ago": how long before `now` an ISO time was, in the largest
// unit that fits. Under a minute, and any time after `now`, is "just now".

const UNITS: ReadonlyArray<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 86_400_000],
  ["month", 30 * 86_400_000],
  ["week", 7 * 86_400_000],
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

export function relativeTime(
  iso: string,
  now: number = Date.now(),
  locale?: string,
): string {
  const ms = now - Date.parse(iso);
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  for (const [unit, size] of UNITS) {
    if (ms >= size) {
      return format.format(-Math.floor(ms / size), unit);
    }
  }
  return "just now";
}
