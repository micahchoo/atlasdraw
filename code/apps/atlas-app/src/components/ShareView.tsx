// SPDX-License-Identifier: AGPL-3.0-only
// ShareView — Phase 4 T8/T9. Read-only viewer for shared maps.
//
// Two entry shapes routed by App.tsx:
//   - Hash form  : `/m#v1:<lz-string base64>` — fully self-contained.
//   - Token form : `/m/<token>` — fetches `.atlasdraw` blob over HTTP.
//
// Render decision (per scrub note): MapEditor is heavily tangled with
// scroll-lock, geo-anchor sync, layer registry wiring, atlas-tool overlay,
// and Excalidraw lifecycle hooks. Factoring it for view-mode would balloon
// the diff. We render a stripped-down read-only canvas here that mounts
// `<Excalidraw viewModeEnabled initialData={...} />` with the scene from
// the shared document. Geo-anchoring is intentionally NOT rehydrated in
// the viewer — Phase 5 reintroduces it once Excalidraw can be cleanly
// driven from a remote document.

import React, { useEffect, useState } from "react";
import { Excalidraw } from "@atlasdraw/excalidraw";

import { type HttpStorageClient } from "../services/createHttpStorageClient";
import {
  loadShareDocument,
  tokenFromPath,
  type ShareLoadResult,
} from "../state/loadShareDocument";

type ViewState = { kind: "loading" } | ShareLoadResult;

export interface ShareViewProps {
  /** Test seam — override the HTTP client. */
  client?: HttpStorageClient;
  /** Test seam — override the location source for path / hash. */
  location?: { pathname: string; hash: string };
}

export const ShareView: React.FC<ShareViewProps> = ({ client, location }) => {
  const [state, setState] = useState<ViewState>({ kind: "loading" });

  useEffect(() => {
    const loc = location ?? {
      pathname: window.location.pathname,
      hash: window.location.hash,
    };
    let cancelled = false;

    void (async () => {
      const token = tokenFromPath(loc.pathname, "/m/");
      const result = await loadShareDocument(loc.hash, token, client);
      if (!cancelled) {
        setState(result);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [client, location]);

  if (state.kind === "loading") {
    return (
      <MessageScreen
        testid="share-view-loading"
        title="Loading shared map…"
        body=""
      />
    );
  }
  if (state.kind === "not-found") {
    return (
      <MessageScreen
        testid="share-view-not-found"
        title="Map not found"
        body="The share link doesn't point to a known map. It may have been deleted."
      />
    );
  }
  if (state.kind === "expired") {
    return (
      <MessageScreen
        testid="share-view-expired"
        title="This share link has expired"
        body="Share links are valid for 7 days. Ask the author for a new link."
      />
    );
  }
  if (state.kind === "error") {
    return (
      <MessageScreen
        testid="share-view-error"
        title="Couldn't load shared map"
        body={state.message}
      />
    );
  }

  // ready — render read-only canvas.
  const doc = state.doc;
  return (
    <div
      style={{ position: "relative", width: "100%", height: "100%" }}
      data-testid="share-view-canvas"
    >
      <div
        data-testid="share-view-banner"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          padding: "0.5rem 1rem",
          background: "var(--ad-accent, #1971c2)",
          color: "var(--ad-ink-inverse, #fff)",
          fontSize: "0.8125rem",
          fontWeight: 600,
          zIndex: 1000,
          textAlign: "center",
        }}
      >
        Read-only share
      </div>
      <div style={{ position: "absolute", inset: 0, paddingTop: "2rem" }}>
        <Excalidraw
          viewModeEnabled
          initialData={{
            elements: doc.scene ?? [],
            appState: { viewBackgroundColor: "#ffffff" },
          }}
        />
      </div>
    </div>
  );
};

const MessageScreen: React.FC<{
  testid: string;
  title: string;
  body: string;
}> = ({ testid, title, body }) => (
  <div
    data-testid={testid}
    style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      width: "100%",
      height: "100%",
      padding: "2rem",
      color: "var(--ad-ink, #212529)",
      textAlign: "center",
    }}
  >
    <h2
      style={{ margin: "0 0 0.5rem 0", fontSize: "1.25rem", fontWeight: 600 }}
    >
      {title}
    </h2>
    {body && (
      <p
        style={{
          margin: 0,
          color: "var(--ad-ink-secondary, #495057)",
          fontSize: "0.875rem",
        }}
      >
        {body}
      </p>
    )}
  </div>
);
