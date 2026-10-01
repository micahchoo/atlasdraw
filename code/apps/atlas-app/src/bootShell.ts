// SPDX-License-Identifier: AGPL-3.0-only
// Boot shell — the markup index.html paints before any JavaScript runs.
//
// Ranks 6 and 38 of docs/performance/boot-payload-audit.md. index.html used to
// ship an empty <div id="root">, so the screen stayed blank for the whole time
// the entry chunk spent downloading, parsing and mounting. The shell is a
// static silhouette of the page's frame — the editor's collar, or the
// viewer's head bar — with no content it could get wrong.
//
// It lives OUTSIDE #root on purpose. createRoot() replaces the children of
// #root on mount, which would wipe a shell placed inside it at the exact
// moment the lazy route chunk starts loading — trading a blank-before-mount
// for a blank-after-mount. Sitting outside, it stays painted underneath until
// something explicitly dismisses it.
//
// Two callers dismiss it, and both are needed:
//   - App.tsx, from inside the route <Suspense> — the normal path, fired when
//     the route chunk has resolved and has something real to show.
//   - ErrorBoundary — the failure path. Without it a chunk that fails to load
//     leaves the shell covering the crash screen forever.

const BOOT_SHELL_ID = "boot-shell";

export function dismissBootShell(): void {
  if (typeof document === "undefined") {
    return;
  }
  document.getElementById(BOOT_SHELL_ID)?.remove();
}
