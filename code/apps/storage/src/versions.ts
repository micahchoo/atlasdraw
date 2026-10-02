// Which earlier bytes of a map the store keeps
// (docs/architecture/adr/0020-server-version-history.md). Both adapters call
// these inside the transaction that swaps a map's bytes, so the rule is
// written once.
//
// The editor saves every few seconds while the owner draws, so "keep every
// save" would fill the history with minutes of work. A write keeps the
// bytes it replaces as a version only when they are a resting point:
//
//   - they stood for `intervalMs` or longer before this write, or
//   - they were saved `intervalMs` or more after the newest kept version,
//     so a long session still leaves one version per interval, or
//   - there is no kept version yet, or
//   - the write asks for it (`checkpoint`), or a frozen link reads them.
//
// Then the oldest versions past `keep` go. A version a frozen link reads is
// never removed and does not count toward `keep`.

/** How many earlier versions a map keeps, and how far apart. */
export interface VersionPolicy {
  /** Versions kept besides the map's own bytes. 0: none. */
  keep: number;
  /** The least time between two kept versions, in ms. */
  intervalMs: number;
}

/** No history: a write replaces the bytes it finds. */
export const NO_VERSIONS: VersionPolicy = { keep: 0, intervalMs: 0 };

/** A kept version, as both adapters store it. */
export interface MapVersion {
  revision: number;
  /** When these bytes were saved: the map's `updated_at` at that time. */
  saved_at: string;
  byte_size: number;
  blob_ref: string;
}

/**
 * Whether the bytes a write replaces stay as a version. `newest` is the
 * newest version kept now; `forced` is a checkpoint or a frozen link.
 */
export function keepsReplaced(
  policy: VersionPolicy,
  replacedAt: string,
  newest: MapVersion | undefined,
  at: Date,
  forced: boolean,
): boolean {
  if (forced) {
    return true;
  }
  if (policy.keep === 0) {
    return false;
  }
  if (!newest) {
    return true;
  }
  const replaced = Date.parse(replacedAt);
  return (
    at.getTime() - replaced >= policy.intervalMs ||
    replaced - Date.parse(newest.saved_at) >= policy.intervalMs
  );
}

/**
 * The versions to remove: those past `keep`, counted newest first, that no
 * frozen link reads. `versions` is newest first.
 */
export function pastKeep(
  versions: readonly MapVersion[],
  pinned: ReadonlySet<number>,
  keep: number,
): MapVersion[] {
  const free = versions.filter((v) => !pinned.has(v.revision));
  return free.slice(keep);
}
