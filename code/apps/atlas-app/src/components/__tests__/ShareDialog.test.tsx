// SPDX-License-Identifier: AGPL-3.0-only
// Phase 4 T8 + Phase 5 collab integration — ShareDialog tests.
//
// Dialog now opens to a mode-picker (Share read-only / Collaborate). The
// existing read-only flow is exercised by clicking "Share read-only" first,
// then asserting the same hash-mode generation as before. New tests exercise
// the Collaborate path: clicking the button calls generateRoomKey + connect,
// and the success URL has the `#room:` prefix.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import * as protocol from "@atlasdraw/protocol";

import { ShareDialog } from "../ShareDialog";
import { usePersistenceStore } from "../../state/usePersistenceStore";

import type { AtlasdrawDocument } from "@atlasdraw/data";
import type { HttpStorageClient } from "../../services/createHttpStorageClient";
import type { CollabState } from "../../state/collab";

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

function stubClient(): HttpStorageClient {
  return {
    createMap: vi.fn(),
    getMap: vi.fn(),
    updateMap: vi.fn(),
    createShareToken: vi.fn(),
    resolveToken: vi.fn(),
    getShareBlob: vi.fn(),
  };
}

function stubCollab(): CollabState & { connect: ReturnType<typeof vi.fn> } {
  return {
    active: true,
    connect: vi.fn(),
  } as unknown as CollabState & { connect: ReturnType<typeof vi.fn> };
}

describe("ShareDialog", () => {
  beforeEach(() => {
    usePersistenceStore.setState({ isDraining: false });
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
        collabState={stubCollab()}
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
        collabState={stubCollab()}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("share-dialog-pick-readonly"));
    });

    await waitFor(() => {
      expect(screen.queryByTestId("share-dialog-url")).not.toBeNull();
    });
    const input = screen.getByTestId("share-dialog-url") as HTMLInputElement;
    expect(input.value.startsWith("https://test.example/m#v1:")).toBe(true);
    const hint = screen.getByTestId("share-dialog-mode-hint");
    expect(hint.getAttribute("data-mode")).toBe("hash");
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
        collabState={stubCollab()}
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
        collabState={stubCollab()}
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
        collabState={stubCollab()}
      />,
    );
    await waitFor(() => {
      expect(screen.queryByTestId("share-dialog-close")).not.toBeNull();
    });
    fireEvent.click(screen.getByTestId("share-dialog-close"));
    expect(onClose).toHaveBeenCalled();
  });

  it("Collaborate button calls generateRoomKey + connect and shows a #room: URL", async () => {
    const stubKey = { type: "secret" } as unknown as CryptoKey;
    const generateSpy = vi
      .spyOn(protocol, "generateRoomKey")
      .mockResolvedValue({
        roomId: "abc-123",
        key: stubKey,
        fragment: "#room:abc-123,KEYB64",
      });
    const collab = stubCollab();
    render(
      <ShareDialog
        onCloseRequest={() => {}}
        getDoc={() => tinyDoc()}
        client={stubClient()}
        collabState={collab}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("share-dialog-pick-collab"));
    });

    await waitFor(() => {
      expect(generateSpy).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(collab.connect).toHaveBeenCalledWith("abc-123", stubKey);
    });
    await waitFor(() => {
      expect(screen.queryByTestId("share-dialog-url")).not.toBeNull();
    });
    const input = screen.getByTestId("share-dialog-url") as HTMLInputElement;
    expect(input.value).toContain("#room:");
    expect(input.value).toBe("https://test.example/#room:abc-123,KEYB64");

    const hint = screen.getByTestId("share-dialog-mode-hint");
    expect(hint.getAttribute("data-mode")).toBe("collab");
    expect(hint.textContent).toMatch(/anyone with this link can edit/i);
  });
});
