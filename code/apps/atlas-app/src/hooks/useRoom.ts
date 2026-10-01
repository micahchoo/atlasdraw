// SPDX-License-Identifier: AGPL-3.0-only
//
// useRoom — the editor in a room (state/room.ts).
//
// A `#room:` link in the URL joins that room when the editor mounts.
// `start()` makes a room from the open map (Share → Collaborate) and puts
// its link in the URL, so a reload stays in the room.
//
// Once the room has joined, the editor opens the room's Document and shows
// the room's drawing; the user's own document waits in memory and comes
// back when the editor unmounts. Opening another document leaves the room. Nothing in the room is written to
// the user's own map: the autosave skips a room's document.
//
// Presence: the pointer's place on the map (map.unproject) and the camera
// after each move go to the room's awareness.

import { useCallback, useEffect, useRef, useState } from "react";

import { CaptureUpdateAction } from "@atlasdraw/element";
import {
  newRoomLink,
  parseRoomLink,
  roomFragment,
  type RoomLink,
} from "@atlasdraw/protocol";

import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw";

import { getAppConfig } from "../config/app-config";
import { routeUrl } from "../routes";
import {
  currentDocument,
  openDocument,
  useDocumentStore,
  type Document,
} from "../state/document";
import { restoreCamera } from "../state/documentIO";
import {
  joinRoom,
  relayTransport,
  type Peer,
  type Room,
  type RoomStatus,
} from "../state/room";
import { editorOf } from "../state/roomScene";
import { usePersistenceStore } from "../state/usePersistenceStore";

import type maplibregl from "maplibre-gl";

export interface RoomSession {
  /** Whether this editor offers rooms at all. */
  readonly available: boolean;
  readonly room: Room | null;
  readonly status: RoomStatus | null;
  /** Everyone else in the room. */
  readonly peers: readonly Peer[];
  /** Why the link in the URL cannot be joined; null when it can. */
  readonly error: string | null;
  /**
   * Make a room from the open map and join it, or keep the room the editor
   * is in. Resolves with the room's URL.
   */
  start(): Promise<string>;
}

function roomUrl(link: RoomLink): string {
  return routeUrl({ kind: "editor", room: link, open: null });
}

const NO_PEERS: readonly Peer[] = [];

export function useRoom(
  api: ExcalidrawImperativeAPI | null,
  map: maplibregl.Map | null,
): RoomSession {
  const realtime = getAppConfig().realtime;
  const [room, setRoom] = useState<Room | null>(null);
  const [status, setStatus] = useState<RoomStatus | null>(null);
  const [peers, setPeers] = useState<readonly Peer[]>(NO_PEERS);
  const [error, setError] = useState<string | null>(null);
  const roomRef = useRef<Room | null>(null);

  const join = useCallback(
    (link: RoomLink, seed?: Document): Room => {
      const transport = relayTransport(
        realtime.wsUrl || window.location.origin,
      );
      const next = joinRoom(link, transport, seed ? { seed } : {});
      roomRef.current = next;
      setRoom(next);
      return next;
    },
    [realtime.wsUrl],
  );

  // A room link in the URL, read once when the editor is ready.
  useEffect(() => {
    if (!api || roomRef.current) {
      return;
    }
    const hash = window.location.hash;
    if (!hash.startsWith("#room:")) {
      return;
    }
    if (!realtime.enabled) {
      setError("This editor is not set up for shared maps.");
      return;
    }
    const link = parseRoomLink(hash);
    if (!link) {
      setError("This shared map link is not valid.");
      return;
    }
    join(link);
    // Once per editor: a hash change later does not move it to another room.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  // In the room: the room's document and drawing in the editor.
  useEffect(() => {
    if (!room || !api) {
      return;
    }
    let previous: {
      doc: Document;
      elements: ReturnType<
        ExcalidrawImperativeAPI["getSceneElementsIncludingDeleted"]
      >;
    } | null = null;
    let detach: (() => void) | null = null;

    const enter = (): void => {
      const roomDocument = room.document;
      if (previous || !roomDocument) {
        return;
      }
      // Write the user's own map before it leaves the editor.
      void usePersistenceStore.getState().forceSave();
      previous = {
        doc: currentDocument(),
        elements: api.getSceneElementsIncludingDeleted(),
      };
      openDocument(roomDocument);
      restoreCamera(roomDocument.snapshot().camera);
      detach = room.attach(editorOf(api));
      api.history?.clear();
    };

    const unsubscribeStatus = room.status((next) => {
      setStatus(next);
      if (next === "joined") {
        enter();
      }
    });
    const unsubscribePeers = room.presence.subscribe(() =>
      setPeers(room.presence.peers()),
    );
    // Another document opened in the editor (a file, My maps, a new map):
    // the editor leaves the room at once, before that document's drawing
    // reaches Excalidraw, so none of it is written to the room.
    const unsubscribeDocument = useDocumentStore.subscribe((state) => {
      if (!previous || state.doc === room.document) {
        return;
      }
      detach?.();
      detach = null;
      previous = null;
      const { pathname, search } = window.location;
      window.history.replaceState(window.history.state, "", pathname + search);
      roomRef.current = null;
      setRoom(null);
    });

    return () => {
      unsubscribeStatus();
      unsubscribePeers();
      unsubscribeDocument();
      detach?.();
      room.leave();
      if (roomRef.current === room) {
        roomRef.current = null;
      }
      if (previous) {
        openDocument(previous.doc);
        api.updateScene({
          elements: previous.elements,
          captureUpdate: CaptureUpdateAction.NEVER,
        });
        api.history?.clear();
      }
      setPeers(NO_PEERS);
      setStatus(null);
    };
  }, [room, api]);

  // Presence: the camera after each move, the pointer while over the map.
  useEffect(() => {
    if (!room || !map || status !== "joined") {
      return;
    }
    const sendCamera = (): void => {
      const c = map.getCenter();
      room.presence.setCamera({
        center: [c.lng, c.lat],
        zoom: map.getZoom(),
        bearing: map.getBearing(),
        pitch: map.getPitch(),
      });
    };
    sendCamera();
    const onPointer = (event: PointerEvent): void => {
      const rect = map.getContainer().getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      if (x < 0 || y < 0 || x > rect.width || y > rect.height) {
        room.presence.setCursor(null);
        return;
      }
      const at = map.unproject([x, y]);
      room.presence.setCursor({ lng: at.lng, lat: at.lat });
    };
    map.on("moveend", sendCamera);
    window.addEventListener("pointermove", onPointer);
    return () => {
      map.off("moveend", sendCamera);
      window.removeEventListener("pointermove", onPointer);
    };
  }, [room, map, status]);

  const start = useCallback(async (): Promise<string> => {
    const current = roomRef.current;
    if (current) {
      return roomUrl(current.link);
    }
    const link = newRoomLink();
    join(link, currentDocument());
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${window.location.search}${roomFragment(
        link,
      )}`,
    );
    return roomUrl(link);
  }, [join]);

  return {
    available: realtime.enabled,
    room,
    status,
    peers,
    error,
    start,
  };
}
