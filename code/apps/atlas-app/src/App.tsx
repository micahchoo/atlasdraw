// SPDX-License-Identifier: AGPL-3.0-only
// App — top-level mount. routes.ts decides what the URL opens; the page reads
// the location once, at mount.

import { Suspense, lazy, useEffect } from "react";

import { dismissBootShell } from "./bootShell";
import { getAppConfig } from "./config/app-config";
import { parseRoute } from "./routes";
import { AriaAnnouncer } from "./components/AriaAnnouncer";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ToastProvider } from "./components/ToastProvider";

// The two route roots load on demand, so a visitor downloads only the one
// that mounts: a share link or an /embed iframe does not pull the editor, and
// an editor visitor does not pull the viewer.
//
// `.then(m => ({ default: ... }))` because each module exports a NAMED
// component and React.lazy resolves `default` only. Keep the named exports —
// the test suite mocks these modules by name.
const MapEditor = lazy(() =>
  import("./components/MapEditor").then((m) => ({ default: m.MapEditor })),
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
  const route = parseRoute(window.location);
  switch (route.kind) {
    case "share":
      return <EmbedView chrome="share" map={route.map} />;
    case "embed":
      if (getAppConfig().embedEnabled) {
        return <EmbedView chrome="minimal" map={route.map} />;
      }
      return <MapEditor initialView={INITIAL_VIEW} />;
    case "editor":
      return <MapEditor initialView={INITIAL_VIEW} open={route.open} />;
  }
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
