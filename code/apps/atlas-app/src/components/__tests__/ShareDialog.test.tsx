// SPDX-License-Identifier: AGPL-3.0-only
// Phase 4 T8 + Phase 5 collab integration — ShareDialog tests.
//
// Dialog now opens to a mode-picker (Share read-only / Collaborate). The
// existing read-only flow is exercised by clicking "Share read-only" first,
// then asserting the same hash-mode generation as before. New tests exercise
// the Collaborate path: clicking the button calls generateRoomKey + connect,
// and the success URL has the `#room:` prefix.

import "fake-indexeddb/auto";
import { openDB } from "idb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import type { AtlasdrawDocument } from "@atlasdraw/data";

import { ShareDialog } from "../ShareDialog";

import type { HttpStorageClient } from "../../services/createHttpStorageClient";

function tinyDoc(): AtlasdrawDocument {
  return {
    manifest: {
      id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      schemaVersion: 1,
      createdAt: "2026-05-10T00:00:00.000Z",
      updatedAt: "2026-05-10T00:00:00.000Z",
      basemap: { kind: "preset", id: "blank" },
      camera: { center: [0, 0], zoom: 1 },
      layers: [],
      permissions: { mode: "public-read" },
    },
    scene: [],
    layers: new Map(),
    styleRef: {},
    files: new Map(),
  } as unknown as AtlasdrawDocument;
}

/** A document too large for a hash link: it goes to the server. */
function bigDoc(): AtlasdrawDocument {
  const noise = new Uint8Array(64 * 1024);
  for (let i = 0; i < noise.length; i++) {
    noise[i] = (Math.imul(i + 1, 2654435761) >>> 24) & 0xff;
  }
  const doc = tinyDoc();
  doc.files.set("img-1", new Blob([noise], { type: "image/png" }));
  return doc;
}

function stubClient(): HttpStorageClient {
  return {
    createMap: vi.fn(async () => ({
      map: {
        id: "abcdefghij1234567890K",
        created_at: "",
        updated_at: "",
        byte_size: 1,
      },
      writeKey: "write-key",
    })),
    updateMap: vi.fn(),
    readMap: vi.fn(),
    createShareToken: vi.fn(
      async (_id: string, _key: string, days: number | null) => ({
        token: "tokentokentokentokenA",
        expiresAt: days === null ? null : "2026-05-17T00:00:00.000Z",
      }),
    ),
    revokeShareToken: vi.fn(async () => {}),
    deleteMap: vi.fn(async () => {}),
    getShareBlob: vi.fn(),
  };
}

/** Lets any deferred setup in the dialog run before the first press. */
const settle = () => new Promise((r) => setTimeout(r, 20));

const ROOM_URL = "https://test.example/#room:abc-123,KEYB64";

function stubStartRoom() {
  return vi.fn(async () => ROOM_URL);
}

describe("ShareDialog", () => {
  beforeEach(async () => {
    const db = await openDB("atlasdraw-autosave", 1, {
      upgrade(d) {
        if (!d.objectStoreNames.contains("state")) {
          d.createObjectStore("state");
        }
      },
    });
    await db.clear("state");
    db.close();
    Object.defineProperty(window, "location", {
      value: { ...window.location, origin: "https://test.example" },
      writable: true,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders the mode picker on initial mount", async () => {
    render(
      <ShareDialog
        onCloseRequest={() => {}}
        getDoc={() => tinyDoc()}
        client={stubClient()}
        startRoom={stubStartRoom()}
      />,
    );
    expect(screen.queryByTestId("share-dialog-mode-picker")).not.toBeNull();
    expect(screen.queryByTestId("share-dialog-pick-readonly")).not.toBeNull();
    expect(screen.queryByTestId("share-dialog-pick-collab")).not.toBeNull();
    expect(screen.queryByTestId("share-dialog-url")).toBeNull();
  });

  it("auto-generates and renders the success state with a copyable URL after picking Share read-only", async () => {
    render(
      <ShareDialog
        onCloseRequest={() => {}}
        getDoc={() => tinyDoc()}
        client={stubClient()}
        startRoom={stubStartRoom()}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("share-dialog-pick-readonly"));
    });

    await waitFor(() => {
      expect(screen.queryByTestId("share-dialog-url")).not.toBeNull();
    });
    const input = screen.getByTestId("share-dialog-url") as HTMLInputElement;
    expect(input.value.startsWith("https://test.example/m#v2:")).toBe(true);
    const hint = screen.getByTestId("share-dialog-mode-hint");
    expect(hint.getAttribute("data-mode")).toBe("hash");
  });

  // The dialog once closed itself when Read-only was chosen: the picker
  // button unmounts during its own click, and a document-level click test saw
  // a detached target. jsdom cannot show that (it needs real input, where the
  // browser runs React's render between listeners); the Playwright spec
  // e2e/share-dialog.spec.ts does. Here: the dialog closes on its backdrop
  // only.
  it("a press on the backdrop closes it; a press in the panel does not", async () => {
    const onClose = vi.fn();
    render(
      <ShareDialog
        onCloseRequest={onClose}
        getDoc={() => tinyDoc()}
        client={stubClient()}
        startRoom={stubStartRoom()}
      />,
    );
    await settle();

    fireEvent.mouseDown(screen.getByTestId("share-dialog-panel"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(screen.getByTestId("share-dialog-overlay"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("a hash link says it is a copy that later edits do not change", async () => {
    render(
      <ShareDialog
        onCloseRequest={() => {}}
        getDoc={() => tinyDoc()}
        client={stubClient()}
        startRoom={stubStartRoom()}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("share-dialog-pick-readonly"));
    });

    const hint = await screen.findByTestId("share-dialog-mode-hint");
    expect(hint.textContent).toMatch(/copy/i);
    expect(hint.textContent).toMatch(/do not change/i);
    expect(screen.queryByTestId("share-dialog-revoke")).toBeNull();
  });

  it("an uploaded link lasts, says saves update it, and can be stopped", async () => {
    const client = stubClient();
    render(
      <ShareDialog
        onCloseRequest={() => {}}
        getDoc={() => bigDoc()}
        client={client}
        startRoom={stubStartRoom()}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("share-dialog-pick-readonly"));
    });

    const input = (await screen.findByTestId(
      "share-dialog-url",
    )) as HTMLInputElement;
    expect(input.value).toBe("https://test.example/m/tokentokentokentokenA");
    expect(client.createShareToken).toHaveBeenCalledWith(
      "abcdefghij1234567890K",
      "write-key",
      null,
    );
    const hint = screen.getByTestId("share-dialog-mode-hint");
    expect(hint.getAttribute("data-mode")).toBe("upload");
    expect(hint.textContent).toMatch(/every embed/i);
    expect(hint.textContent).toMatch(/until you stop/i);

    fireEvent.click(screen.getByTestId("share-dialog-revoke"));
    // Stopping breaks every copy of the link, so it asks first, in red.
    expect(client.revokeShareToken).not.toHaveBeenCalled();
    expect(
      screen.getByTestId("confirm-dialog-confirm").getAttribute("data-tone"),
    ).toBe("destructive");
    await act(async () => {
      fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));
    });

    await screen.findByTestId("share-dialog-revoked");
    expect(client.revokeShareToken).toHaveBeenCalledWith(
      "abcdefghij1234567890K",
      "write-key",
      "tokentokentokentokenA",
    );
    expect(screen.queryByTestId("share-dialog-url")).toBeNull();
  });

  it("Escape on the stop-sharing question keeps the link and the dialog", async () => {
    const client = stubClient();
    const onCloseRequest = vi.fn();
    render(
      <ShareDialog
        onCloseRequest={onCloseRequest}
        getDoc={() => bigDoc()}
        client={client}
        startRoom={stubStartRoom()}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId("share-dialog-pick-readonly"));
    });
    await screen.findByTestId("share-dialog-url");

    fireEvent.click(screen.getByTestId("share-dialog-revoke"));
    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByTestId("confirm-dialog")).toBeNull();
    expect(onCloseRequest).not.toHaveBeenCalled();
    expect(client.revokeShareToken).not.toHaveBeenCalled();
    expect(screen.getByTestId("share-dialog-url")).toBeTruthy();
  });

  it("an expiry chosen before sharing goes to the server and shows", async () => {
    const client = stubClient();
    render(
      <ShareDialog
        onCloseRequest={() => {}}
        getDoc={() => bigDoc()}
        client={client}
        startRoom={stubStartRoom()}
      />,
    );

    fireEvent.change(screen.getByTestId("share-dialog-expiry"), {
      target: { value: "7" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("share-dialog-pick-readonly"));
    });

    await screen.findByTestId("share-dialog-url");
    expect(client.createShareToken).toHaveBeenCalledWith(
      "abcdefghij1234567890K",
      "write-key",
      7,
    );
    expect(screen.getByTestId("share-dialog-mode-hint").textContent).toMatch(
      /stops working/i,
    );
  });

  it("copy button writes the URL to navigator.clipboard", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      writable: true,
      configurable: true,
    });

    render(
      <ShareDialog
        onCloseRequest={() => {}}
        getDoc={() => tinyDoc()}
        client={stubClient()}
        startRoom={stubStartRoom()}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("share-dialog-pick-readonly"));
    });

    await waitFor(() => {
      expect(screen.queryByTestId("share-dialog-url")).not.toBeNull();
    });
    const url = (screen.getByTestId("share-dialog-url") as HTMLInputElement)
      .value;

    await act(async () => {
      fireEvent.click(screen.getByTestId("share-dialog-copy"));
    });

    expect(writeText).toHaveBeenCalledWith(url);
  });

  it("Escape key invokes onCloseRequest", async () => {
    const onClose = vi.fn();
    render(
      <ShareDialog
        onCloseRequest={onClose}
        getDoc={() => tinyDoc()}
        client={stubClient()}
        startRoom={stubStartRoom()}
      />,
    );
    await waitFor(() => {
      expect(screen.queryByTestId("share-dialog-panel")).not.toBeNull();
    });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("Close button invokes onCloseRequest", async () => {
    const onClose = vi.fn();
    render(
      <ShareDialog
        onCloseRequest={onClose}
        getDoc={() => tinyDoc()}
        client={stubClient()}
        startRoom={stubStartRoom()}
      />,
    );
    await waitFor(() => {
      expect(screen.queryByTestId("share-dialog-close")).not.toBeNull();
    });
    fireEvent.click(screen.getByTestId("share-dialog-close"));
    expect(onClose).toHaveBeenCalled();
  });

  it("Collaborate starts the room and shows its #room: URL", async () => {
    const startRoom = stubStartRoom();
    render(
      <ShareDialog
        onCloseRequest={() => {}}
        getDoc={() => tinyDoc()}
        client={stubClient()}
        startRoom={startRoom}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("share-dialog-pick-collab"));
    });

    expect(startRoom).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.queryByTestId("share-dialog-url")).not.toBeNull();
    });
    const input = screen.getByTestId("share-dialog-url") as HTMLInputElement;
    expect(input.value).toContain("#room:");
    expect(input.value).toBe(ROOM_URL);

    const hint = screen.getByTestId("share-dialog-mode-hint");
    expect(hint.getAttribute("data-mode")).toBe("collab");
    expect(hint.textContent).toMatch(/anyone with this link can edit/i);
  });

  it("offers no Collaborate when the editor has no rooms", () => {
    render(
      <ShareDialog
        onCloseRequest={() => {}}
        getDoc={() => tinyDoc()}
        client={stubClient()}
        startRoom={null}
      />,
    );
    expect(screen.queryByTestId("share-dialog-pick-readonly")).not.toBeNull();
    expect(screen.queryByTestId("share-dialog-pick-collab")).toBeNull();
  });
});
