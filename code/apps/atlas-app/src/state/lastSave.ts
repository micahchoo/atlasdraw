// SPDX-License-Identifier: AGPL-3.0-only
//
// The save the editor made as it went away. When a render error takes the
// editor down, usePersistenceWiring saves the open map's unsaved changes
// and records the promise here; the crash screen (components/ErrorBoundary)
// is outside every editor session, so it reads it here, says what happened
// and waits for it before a reload.
//
// One value for the page, like the announcer: there is one crash screen.

let last: Promise<boolean> = Promise.resolve(true);

/** Record a save; its result replaces the one before. */
export function trackSave(save: Promise<unknown>): void {
  last = save.then(
    () => true,
    () => false,
  );
}

/** True when the last tracked save wrote, or there was none to make. */
export function lastSave(): Promise<boolean> {
  return last;
}
