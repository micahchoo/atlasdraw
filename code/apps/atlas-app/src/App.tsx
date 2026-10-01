// SPDX-License-Identifier: AGPL-3.0-only
// App — top-level mount.
//
// Phase 4 T8/T9 amendment: hand-rolled path detection (no router dep). The
// recipient navigates to a `/m...` link freshly; no SPA navigation is needed
// within the share view, so we read `window.location` once at mount.
//
// Phase 5 collab integration (Step 8) — adds a `#room:` fragment route on `/`
// that mounts MapEditor (write-capable) per Q-P5-2. Defensive: `#room:` on a
// `/m` path is treated as ShareView (read-only) — never grants write
// capability via path mismatch.
//
// Routes:
//   /m#v1:<encoded>      → ShareView (hash mode)
//   /m/<token>           → ShareView (upload mode)
//   /m#room:...          → ShareView (defensive — Q-P5-2; treat as read-only)
//   /#room:<id>,<key>    → MapEditor (collab session; URL key = write cap)
//   anything else        → MapEditor (the editor)

import { Suspense, lazy, useEffect } from "react";

import { dismissBootShell } from "./bootShell";
import { AriaAnnouncer } from "./components/AriaAnnouncer";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ToastProvider } from "./components/ToastProvider";

// The three route roots load on demand, so a visitor downloads only the one
// that mounts: an /embed iframe does not pull the editor, and an editor
// visitor does not pull the read-only views. Exactly one of these mounts per
// page load.
//
// `.then(m => ({ default: ... }))` because each module exports a NAMED
// component and React.lazy resolves `default` only. Keep the named exports —
// the test suite mocks these modules by name.
const MapEditor = lazy(() =>
  import("./components/MapEditor").then((m) => ({ default: m.MapEditor })),
);
const ShareView = lazy(() =>
  import("./components/ShareView").then((m) => ({ default: m.ShareView })),
);
const EmbedView = lazy(() =>
  import("./components/EmbedView").then((m) => ({ default: m.EmbedView })),
);

// India default viewport — matches both the maintainer's interest area and
// the world-low-zoom.pmtiles archive (zoom 0-6 global coverage). Per-user
// override belongs in a user-settings store (deferred to Phase 5+).
const INITIAL_VIEW = {
  center: [78.5, 22] as [number, number],
  zoom: 4,
};

function pickView() {
  // SSR / jsdom guard — `window` exists in our test environment (jsdom),
  // but a defensive check costs nothing.
  if (typeof window === "undefined") {
    return <MapEditor initialView={INITIAL_VIEW} />;
  }
  const path = window.location.pathname;
  const hash = window.location.hash;
  // D1: read-only MAP embed. Distinct from ShareView (`/m`) — mounts the full
  // MapLibre stack chromeless for cross-origin <iframe> use. `/embed#v1:<lz>`
  // (hash) and `/embed/<token>` (token). Enabled by default; operators opt out
  // with VITE_EMBED_ENABLED=false.
  if (
    (path === "/embed" || path.startsWith("/embed/")) &&
    import.meta.env.VITE_EMBED_ENABLED !== "false"
  ) {
    return <EmbedView />;
  }
  // Q-P5-2: a `#room:` fragment under `/m` is a path mismatch — never grant
  // write capability via the share-view path. Treat as read-only.
  if (path === "/m" && hash.startsWith("#room:")) {
    return <ShareView />;
  }
  if (path === "/m" && hash.startsWith("#v1:")) {
    return <ShareView />;
  }
  if (path.startsWith("/m/")) {
    return <ShareView />;
  }
  // Q-P5-2: `#room:` on the editor path (`/`) is the write-capable collab
  // entry point. MapEditor mounts useCollabRoom which decodes the key and
  // opens the live session.
  if (path === "/" && hash.startsWith("#room:")) {
    return <MapEditor initialView={INITIAL_VIEW} />;
  }
  return <MapEditor initialView={INITIAL_VIEW} />;
}

function BootShellDismiss(): null {
  useEffect(() => {
    dismissBootShell();
  }, []);
  return null;
}

export function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <div style={{ position: "relative", width: "100%", height: "100%" }}>
          {/* fallback={null} deliberately: the boot shell painted by
              index.html is still on screen underneath and stays there until
              the route mounts (see bootShell.ts). A fallback here would
              replace that shell with a second, different blank.
              BootShellDismiss is a SIBLING of the route inside the boundary,
              so it mounts only once the route chunk has resolved. */}
          <Suspense fallback={null}>
            {pickView()}
            <BootShellDismiss />
          </Suspense>
          {/* Phase 6 A14b — single hidden aria-live region for screen-reader
              announcements. See components/AriaAnnouncer.tsx. */}
          <AriaAnnouncer />
        </div>
      </ToastProvider>
    </ErrorBoundary>
  );
}
