// SPDX-License-Identifier: AGPL-3.0-only
// Phase 4 T8 — ShareDialog tests.
//
// Render the dialog with a stubbed HttpStorageClient + getDoc that returns a
// tiny document. The hook auto-fires generate() on mount; we wait for the
// success state and assert:
//   - data-testid="share-dialog-url" contains the encoded URL.
//   - copy button writes to navigator.clipboard.
//   - escape / close button dismiss the dialog.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { ShareDialog } from "../ShareDialog";
import { usePersistenceStore } from "../../state/usePersistenceStore";
import type { AtlasdrawDocument } from "@atlasdraw/data";
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
  });

  it("auto-generates and renders the success state with a copyable URL", async () => {
    render(
      <ShareDialog
        onCloseRequest={() => {}}
        getDoc={() => tinyDoc()}
        client={stubClient()}
      />,
    );

    // Loading should appear briefly; then resolve to success.
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
      />,
    );

    await waitFor(() => {
      expect(screen.queryByTestId("share-dialog-url")).not.toBeNull();
    });
    const url = (screen.getByTestId("share-dialog-url") as HTMLInputElement).value;

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
      />,
    );
    await waitFor(() => {
      expect(screen.queryByTestId("share-dialog-close")).not.toBeNull();
    });
    fireEvent.click(screen.getByTestId("share-dialog-close"));
    expect(onClose).toHaveBeenCalled();
  });
});
