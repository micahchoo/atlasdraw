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

import { MapEditor } from "./components/MapEditor";
import { ShareView } from "./components/ShareView";

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

export function App() {
  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      {pickView()}
    </div>
  );
}
