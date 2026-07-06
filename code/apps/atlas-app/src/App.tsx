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
//   /billing             → BillingPage (managed-mode upgrade page; A13a)
//   anything else        → MapEditor (the editor)

import { AriaAnnouncer } from "./components/AriaAnnouncer";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ToastProvider } from "./components/ToastProvider";
import { BillingPage } from "./components/BillingPage";
import { MapEditor } from "./components/MapEditor";
import { ShareView } from "./components/ShareView";
import { EmbedView } from "./components/EmbedView";
import { getAppConfig } from "./config/app-config";
import { createHttpStorageClient } from "./services/createHttpStorageClient";
import { resolveWorkspaceFromEnv } from "./state/workspace";

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
  // D1 (flag VITE_EMBED_ENABLED): read-only MAP embed. Distinct from ShareView
  // (`/m`) — mounts the full MapLibre stack chromeless for cross-origin
  // <iframe> use. `/embed#v1:<lz>` (hash) and `/embed/<token>` (token).
  if (
    (path === "/embed" || path.startsWith("/embed/")) &&
    import.meta.env.VITE_EMBED_ENABLED === "true"
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
  // Phase 6 A13a: `/billing` route — Stripe checkout entry point. Renders
  // in self-host too (with a FOSS hint) so users following an "Upgrade" link
  // accidentally on a self-host deploy get a sensible explanation.
  //
  // workspaceId resolution: prefer `?workspaceId=` query (set by the in-app
  // Upgrade button so the active workspace survives the full-page reload),
  // then fall back to the A9 env resolver (`VITE_WORKSPACE_ID`). In a
  // multi-tenant managed deploy the env var is not set per-user, so the
  // query-string hop is the load-bearing path — without it every BillingPage
  // visit renders disabled Upgrade buttons.
  if (path === "/billing") {
    const cfg = getAppConfig();
    const params = new URLSearchParams(window.location.search);
    const queryWs = params.get("workspaceId");
    const envCtx = resolveWorkspaceFromEnv(
      typeof import.meta.env === "undefined"
        ? {}
        : (import.meta.env as Record<string, string | undefined>),
    );
    const workspaceId = queryWs && queryWs !== "" ? queryWs : envCtx.id;
    const client = createHttpStorageClient({
      baseUrl: cfg.storageBaseUrl,
      getWorkspaceId: () => workspaceId,
    });
    return <BillingPage client={client} workspaceId={workspaceId} />;
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
    <ErrorBoundary>
      <ToastProvider>
        <div style={{ position: "relative", width: "100%", height: "100%" }}>
          {pickView()}
          {/* Phase 6 A14b — single hidden aria-live region for screen-reader
              announcements. See components/AriaAnnouncer.tsx. */}
          <AriaAnnouncer />
        </div>
      </ToastProvider>
    </ErrorBoundary>
  );
}
