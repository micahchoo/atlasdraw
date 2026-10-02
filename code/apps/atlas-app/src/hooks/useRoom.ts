// SPDX-License-Identifier: AGPL-3.0-only
//
// useRoom — the editor in a room (state/room.ts).
//
// A `#room:` link in the URL joins that room when the editor mounts. A room
// link that arrives later in the same tab (pasted into the address bar, or
// a link clicked) joins too: at once when the editor is in no room, after a
// question when it would leave another room. A "no" puts the room's own
// link back in the URL. A link that is not valid says so.
// `start()` makes a room from the open map (Share → Collaborate) and puts
// its link in the URL, so a reload stays in the room.
//
// Once the room has joined, the editor opens the room's Document and shows
// the room's drawing; the user's own document waits in memory and comes
// back when the editor unmounts. A room joined before the autosave opened
// the user's own map waits for it (persistenceState.ts#ownMapLoaded): the
// map that waits in memory must be theirs, not the blank start. Opening another document leaves the room. Nothing in the room is written to
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

import { routeUrl } from "../routes";
import {
  currentDocument,
  openDocument,
  useDocumentStore,
  type Document,
} from "../state/document";
import { liveCamera, restoreCamera } from "../state/documentIO";
import { planSeed, type Seed } from "../state/roomDocument";
import {
  joinRoom,
  type Peer,
  type Room,
  type RoomStatus,
  type RoomTransport,
} from "../state/room";
import { setDisplayName, type Identity } from "../state/identity";
import { editorOf } from "../state/roomScene";

import type { ViewStore } from "../session/view";
import type { History } from "../session/history";
import type { PersistenceStateStore } from "../state/persistenceState";
import type * as maplibregl from "maplibre-gl";

export interface RoomSession {
  /** Whether this editor offers rooms at all. */
  readonly available: boolean;
  readonly room: Room | null;
  readonly status: RoomStatus | null;
  /** The room's reason for a refusal, with sizes; null otherwise (Room.reason). */
  readonly reason: string | null;
  /** True while the editor shows the room's document. */
  readonly entered: boolean;
  /** Everyone else in the room. */
  readonly peers: readonly Peer[];
  /** This person as the room sees them; null outside a room. */
  readonly self: Identity | null;
  /** Set this person's display name: saved in this browser, shown to the room. */
  rename(name: string): void;
  /** Why the link in the URL cannot be joined; null when it can. */
  readonly error: string | null;
  /**
   * Make a room from the open map and join it, or keep the room the editor
   * is in. Resolves with the room's URL. Rejects, before anything
   * connects, when the map is over a size cap: the error names the size
   * and the cap.
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
  /**
   * The session's room transport (null: this editor has no rooms), its
   * autosave state, which a room waits for, its history, which says
   * whether the user's own map has unsaved changes, and its view, which
   * asks before a link moves the editor from one room to another.
   */
  session: {
    transport: RoomTransport | null;
    persistence: PersistenceStateStore;
    history: Pick<History, "dirty">;
    view: ViewStore;
  },
): RoomSession {
  const { transport, persistence, history, view } = session;
  const [room, setRoom] = useState<Room | null>(null);
  const [status, setStatus] = useState<RoomStatus | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [entered, setEntered] = useState(false);
  const [peers, setPeers] = useState<readonly Peer[]>(NO_PEERS);
  const [self, setSelf] = useState<Identity | null>(null);
  const [error, setError] = useState<string | null>(null);
  const roomRef = useRef<Room | null>(null);
  const mapRef = useRef(map);
  mapRef.current = map;

  const join = useCallback(
    (link: RoomLink, seed?: Seed): Room | null => {
      if (!transport) {
        return null;
      }
      const next = joinRoom(link, transport, seed ? { seed } : {});
      roomRef.current = next;
      setRoom(next);
      return next;
    },
    [transport],
  );

  // A room link in the URL: read when the editor is ready, and again each
  // time the hash changes in this tab.
  useEffect(() => {
    if (!api) {
      return;
    }
    const follow = (): void => {
      const hash = window.location.hash;
      if (!hash.startsWith("#room:")) {
        return;
      }
      if (!transport) {
        setError("This editor is not set up for shared maps.");
        return;
      }
      const link = parseRoomLink(hash);
      if (!link) {
        setError("This shared map link is not valid.");
        return;
      }
      setError(null);
      const current = roomRef.current;
      if (!current) {
        join(link);
        return;
      }
      if (roomFragment(current.link) === roomFragment(link)) {
        return;
      }
      void view
        .getState()
        .ask({
          title: "Open the other shared map?",
          body: "The link opens another shared map. You leave this one. Your own map stays saved and unchanged.",
          confirmLabel: "Open the other shared map",
          cancelLabel: "Stay here",
        })
        .then((yes) => {
          if (yes && roomRef.current === current) {
            join(link);
            return;
          }
          // Stayed: the URL names the room the editor is in.
          const { pathname, search } = window.location;
          const stay = roomRef.current;
          window.history.replaceState(
            window.history.state,
            "",
            pathname + search + (stay ? roomFragment(stay.link) : ""),
          );
        });
    };
    if (!roomRef.current) {
      follow();
    }
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, [api, transport, join, view]);

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
    let stopWaiting: () => void = () => {};

    const enter = (): void => {
      const roomDocument = room.document;
      if (previous || !roomDocument) {
        return;
      }
      const own = persistence.getState();
      if (!own.ownMapLoaded) {
        stopWaiting();
        stopWaiting = persistence.subscribe((state) => {
          if (state.ownMapLoaded) {
            stopWaiting();
            enter();
          }
        });
        return;
      }
      // Write the user's unsaved changes before their map leaves the editor.
      if (history.dirty) {
        void own.forceSave();
      }
      previous = {
        doc: currentDocument(),
        elements: api.getSceneElementsIncludingDeleted(),
      };
      openDocument(roomDocument);
      restoreCamera(mapRef.current, roomDocument.snapshot().camera);
      detach = room.attach(editorOf(api));
      api.history?.clear();
      setEntered(true);
    };

    const unsubscribeStatus = room.status((next) => {
      setStatus(next);
      setReason(room.reason);
      if (next === "joined") {
        enter();
      }
    });
    const unsubscribePeers = room.presence.subscribe(() =>
      setPeers(room.presence.peers()),
    );
    setSelf(room.presence.self);
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
      stopWaiting();
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
      setSelf(null);
      setStatus(null);
      setReason(null);
      setEntered(false);
    };
  }, [room, api, persistence, history]);

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
    const plan = await planSeed(currentDocument(), liveCamera(mapRef.current));
    if (!plan.ok) {
      throw new Error(plan.reason);
    }
    if (roomRef.current) {
      // Another start() made a room while this one measured the map.
      return roomUrl(roomRef.current.link);
    }
    const link = newRoomLink();
    join(link, plan);
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${window.location.search}${roomFragment(
        link,
      )}`,
    );
    return roomUrl(link);
  }, [join]);

  const rename = useCallback(
    (name: string): void => {
      const next = setDisplayName(name);
      room?.presence.setName(next.name);
      setSelf(room ? room.presence.self : null);
    },
    [room],
  );

  return {
    available: transport !== null,
    room,
    status,
    reason,
    entered,
    peers,
    self,
    rename,
    error,
    start,
  };
}

const REFUSALS: ReadonlySet<RoomStatus> = new Set<RoomStatus>([
  "denied",
  "full",
  "too-large",
  "limited",
  "no-space",
  "unavailable",
  "damaged",
]);

/** Why the editor cannot be in the room, in the user's words; null when it can. */
export function roomProblem(
  room: Pick<RoomSession, "error" | "status" | "reason" | "entered">,
): string | null {
  if (room.error) {
    return room.error;
  }
  const why = refusalText(room);
  if (!why) {
    return null;
  }
  // The editor still shows the room's document; nothing typed now arrives.
  return room.entered
    ? `${why} Edits you make in this map are no longer saved.`
    : why;
}

function refusalText(
  room: Pick<RoomSession, "status" | "reason">,
): string | null {
  switch (room.status) {
    case "denied":
      return "This shared map link was refused. Ask for a new link.";
    case "full":
      return "This shared map is full. Try again later.";
    case "too-large":
      return room.reason ?? "This shared map is over the server's size limit.";
    case "limited":
      return "Too many shared maps were opened from your network. Try again in an hour.";
    case "no-space":
      return "The server has no space for shared maps. Tell the person who runs it.";
    case "unavailable":
      return room.reason ?? "Shared maps are not available on this page.";
    case "damaged":
      return room.reason ?? "This shared map is damaged and cannot open.";
    default:
      return null;
  }
}

/**
 * The room's connection in a few words, for the presence list; null when
 * the room is joined and nothing needs saying.
 */
export function roomConnection(
  room: Pick<RoomSession, "status">,
): string | null {
  switch (room.status) {
    case "connecting":
      return "Connecting…";
    case "offline":
      return "Offline. Reconnecting…";
    case null:
    case "joined":
      return null;
    default:
      return REFUSALS.has(room.status)
        ? "Not connected. Edits are not saved."
        : null;
  }
}
