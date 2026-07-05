// SPDX-License-Identifier: AGPL-3.0-only
// Phase 4 T8/T9 — ShareView tests.
//
// Hash form is decoded from the URL fragment; token form fetches the blob
// through the injected client. Both paths verify the load + render decision
// without actually mounting Excalidraw — we just confirm the banner renders
// on success, and the appropriate message screen renders on each error.

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import LZString from "lz-string";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ShareView } from "../ShareView";
import {
  ShareExpiredError,
  type HttpStorageClient,
} from "../../services/createHttpStorageClient";

// Excalidraw renders a heavy canvas in jsdom; mock it down to a sentinel.
vi.mock("@atlasdraw/excalidraw", () => ({
  Excalidraw: () => null,
  MainMenu: () => null,
}));

function stubClient(
  overrides: Partial<HttpStorageClient> = {},
): HttpStorageClient {
  return {
    createMap: vi.fn(),
    getMap: vi.fn(),
    updateMap: vi.fn(),
    createShareToken: vi.fn(),
    resolveToken: vi.fn(),
    getShareBlob: vi.fn(async () => null),
    ...overrides,
  };
}

describe("ShareView", () => {
  afterEach(() => {
    cleanup();
  });

  it("hash form: decodes #v1:<encoded> and renders the read-only banner", async () => {
    const doc = {
      manifest: { id: "01ARZ3NDEKTSV4RRFFQ69G5FAV" },
      scene: [],
    };
    const enc = LZString.compressToBase64(JSON.stringify(doc));
    render(
      <ShareView
        location={{ pathname: "/m", hash: `#v1:${enc}` }}
        client={stubClient()}
      />,
    );
    await waitFor(() => {
      expect(screen.queryByTestId("share-view-banner")).not.toBeNull();
    });
    expect(screen.queryByTestId("share-view-canvas")).not.toBeNull();
  });

  it("hash form: corrupted payload renders error screen", async () => {
    render(
      <ShareView
        location={{ pathname: "/m", hash: "#v1:not-valid-base64-data!!" }}
        client={stubClient()}
      />,
    );
    await waitFor(() => {
      expect(screen.queryByTestId("share-view-error")).not.toBeNull();
    });
  });

  it("token form: calls getShareBlob with the parsed token", async () => {
    const getShareBlob = vi.fn(async () => null);
    render(
      <ShareView
        location={{ pathname: "/m/abcdefghij1234567890K", hash: "" }}
        client={stubClient({ getShareBlob })}
      />,
    );
    await waitFor(() => {
      expect(getShareBlob).toHaveBeenCalledWith("abcdefghij1234567890K");
    });
    await waitFor(() => {
      expect(screen.queryByTestId("share-view-not-found")).not.toBeNull();
    });
  });

  it("token form: ShareExpiredError renders the expired screen", async () => {
    const getShareBlob = vi.fn(async () => {
      throw new ShareExpiredError();
    });
    render(
      <ShareView
        location={{ pathname: "/m/abcdefghij1234567890K", hash: "" }}
        client={stubClient({ getShareBlob })}
      />,
    );
    await waitFor(() => {
      expect(screen.queryByTestId("share-view-expired")).not.toBeNull();
    });
  });

  it("token form: malformed token in path renders error", async () => {
    render(
      <ShareView
        location={{ pathname: "/m/not-a-token", hash: "" }}
        client={stubClient()}
      />,
    );
    await waitFor(() => {
      expect(screen.queryByTestId("share-view-error")).not.toBeNull();
    });
  });
});
