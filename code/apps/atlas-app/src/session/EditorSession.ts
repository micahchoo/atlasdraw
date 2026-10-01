// SPDX-License-Identifier: AGPL-3.0-only
//
// EditorSession: one editor's modules, composed. MapEditor creates one when
// it mounts and provides it to every view through SessionContext, the
// Layers tab included (a tab registered with registerSidebarTab renders
// inside <Excalidraw>, so it is in the provider's tree).
//
// The session holds no logic. Each part is a module of its own, and the
// session only hands the same instances to everything that asks:
//
//   store      the open document (state/document.ts)
//   scene      the drawing, as the document reads it (state/scene.ts)
//   transport  how a room reaches its relay (state/room.ts); null when this
//              build has no rooms
//   view       the editor's view state (session/view.ts)

import { createViewStore, type ViewStore } from "./view";

import type { DocumentStore } from "../state/document";
import type { RoomTransport } from "../state/room";
import type { SceneAccess } from "../state/scene";
import type maplibregl from "maplibre-gl";

export interface SessionDeps {
  store: DocumentStore;
  scene: SceneAccess;
  transport: RoomTransport | null;
  /** A map that is already loaded; normally the map arrives later. */
  map?: maplibregl.Map | null;
}

export interface EditorSession {
  readonly store: DocumentStore;
  readonly scene: SceneAccess;
  readonly transport: RoomTransport | null;
  readonly view: ViewStore;
}

export function createSession(deps: SessionDeps): EditorSession {
  return {
    store: deps.store,
    scene: deps.scene,
    transport: deps.transport,
    view: createViewStore({ map: deps.map }),
  };
}
