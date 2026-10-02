// SPDX-License-Identifier: AGPL-3.0-only
//
// Development builds put the editor's handles on `window.__atlasdraw__` for
// the Playwright specs and scripts/bench-world-coords.mjs. A production build
// drops the whole effect: Vite replaces `import.meta.env.DEV` with false.
//
// VITE_E2E_HOOKS=1 is the one exception: a production build made for the
// e2e suite (playwright.build.config.ts, hosted target) keeps the handles,
// so the specs that read the session can run on built code. No published
// build sets it; the Pages e2e builds as pages.yml does and checks that the
// hook is absent.

import { useEffect } from "react";

import { toLngLat, toScene } from "@atlasdraw/geo";

import type { CameraBridge } from "@atlasdraw/basemap";
import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw";

import { seedShapes } from "../lib/devSeedShapes";

import type { EditorSession } from "../session/EditorSession";
import type * as maplibregl from "maplibre-gl";

export function useDevHandles(
  session: EditorSession,
  map: maplibregl.Map | null,
  api: ExcalidrawImperativeAPI | null,
  cameraBridge: CameraBridge | null,
): void {
  useEffect(() => {
    const hooks = import.meta.env.DEV || import.meta.env.VITE_E2E_HOOKS === "1";
    if (!hooks || !map || !api) {
      return;
    }
    const frame = () => session.store.getState().doc.snapshot().world;
    const w = window as unknown as { __atlasdraw__?: unknown };
    w.__atlasdraw__ = {
      map,
      excalidrawAPI: api,
      session,
      cameraBridge,
      seed: (n: number) => seedShapes(map, api, n, frame()),
      frame,
      isDirty: () => session.history.dirty,
      clearDirty: () => session.history.markSaved(),
      toLngLat,
      toScene,
    };
    return () => {
      delete w.__atlasdraw__;
    };
  }, [session, map, api, cameraBridge]);
}
