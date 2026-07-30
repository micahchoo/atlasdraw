// SPDX-License-Identifier: AGPL-3.0-only
// useCollabDocumentTitle — document name over the shared Y.Doc.
//
// Two-peer tests run two real Y.Docs and relay updates between them by hand
// (the same shape as the relay's sync loop), so what's asserted is genuine
// CRDT convergence rather than a mocked channel.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import * as Y from "yjs";

import {
  DEFAULT_DOCUMENT_TITLE,
  useDocumentTitleStore,
} from "../state/documentTitle";

import {
  META_MAP_KEY,
  TITLE_KEY,
  useCollabDocumentTitle,
} from "./useCollabDocumentTitle";

/** Wire two docs together so each applies the other's updates. */
function relay(a: Y.Doc, b: Y.Doc): () => void {
  const aToB = (update: Uint8Array, origin: unknown) => {
    if (origin !== "relay") {
      Y.applyUpdate(b, update, "relay");
    }
  };
  const bToA = (update: Uint8Array, origin: unknown) => {
    if (origin !== "relay") {
      Y.applyUpdate(a, update, "relay");
    }
  };
  a.on("update", aToB);
  b.on("update", bToA);
  return () => {
    a.off("update", aToB);
    b.off("update", bToA);
  };
}

beforeEach(() => {
  useDocumentTitleStore.setState({ title: DEFAULT_DOCUMENT_TITLE });
});

afterEach(() => {
  cleanup();
});

describe("useCollabDocumentTitle", () => {
  it("does nothing without a Y.Doc (collab inactive)", () => {
    renderHook(() => useCollabDocumentTitle(null));
    expect(useDocumentTitleStore.getState().title).toBe(DEFAULT_DOCUMENT_TITLE);
  });

  it("publishes the local name into an empty room", () => {
    const doc = new Y.Doc();
    useDocumentTitleStore.setState({ title: "First in the room" });

    renderHook(() => useCollabDocumentTitle(doc));

    expect(doc.getMap<string>(META_MAP_KEY).get(TITLE_KEY)).toBe(
      "First in the room",
    );
  });

  it("adopts the room's name instead of overwriting it on join", () => {
    const doc = new Y.Doc();
    doc.getMap<string>(META_MAP_KEY).set(TITLE_KEY, "Named by the host");
    useDocumentTitleStore.setState({ title: "My local name" });

    renderHook(() => useCollabDocumentTitle(doc));

    expect(useDocumentTitleStore.getState().title).toBe("Named by the host");
    expect(doc.getMap<string>(META_MAP_KEY).get(TITLE_KEY)).toBe(
      "Named by the host",
    );
  });

  it("pushes a local rename to the peer", () => {
    const local = new Y.Doc();
    const peer = new Y.Doc();
    const unwire = relay(local, peer);
    renderHook(() => useCollabDocumentTitle(local));

    act(() => {
      useDocumentTitleStore.getState().setTitle("Bidar wards");
    });

    expect(peer.getMap<string>(META_MAP_KEY).get(TITLE_KEY)).toBe(
      "Bidar wards",
    );
    unwire();
  });

  it("applies a peer's rename to the local store", () => {
    const local = new Y.Doc();
    const peer = new Y.Doc();
    const unwire = relay(local, peer);
    renderHook(() => useCollabDocumentTitle(local));

    act(() => {
      peer.getMap<string>(META_MAP_KEY).set(TITLE_KEY, "Renamed by peer");
    });

    expect(useDocumentTitleStore.getState().title).toBe("Renamed by peer");
    unwire();
  });

  it("stops syncing after unmount", () => {
    const local = new Y.Doc();
    const peer = new Y.Doc();
    const unwire = relay(local, peer);
    const { unmount } = renderHook(() => useCollabDocumentTitle(local));

    unmount();
    act(() => {
      peer.getMap<string>(META_MAP_KEY).set(TITLE_KEY, "Too late");
    });

    expect(useDocumentTitleStore.getState().title).toBe(DEFAULT_DOCUMENT_TITLE);
    unwire();
  });

  it("ignores a blank remote title rather than blanking the name", () => {
    const local = new Y.Doc();
    const peer = new Y.Doc();
    const unwire = relay(local, peer);
    useDocumentTitleStore.setState({ title: "Keep me" });
    renderHook(() => useCollabDocumentTitle(local));

    act(() => {
      peer.getMap<string>(META_MAP_KEY).set(TITLE_KEY, "   ");
    });

    expect(useDocumentTitleStore.getState().title).toBe("Keep me");
    unwire();
  });
});
