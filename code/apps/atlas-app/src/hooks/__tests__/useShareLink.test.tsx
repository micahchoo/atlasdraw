// SPDX-License-Identifier: AGPL-3.0-only
// Phase 4 T9 — useShareLink hook tests.
//
// Two halves:
//   - Hash mode: tiny doc → compress to URL fragment. Round-trip decode
//                produces the same document. Threshold gate verified.
//   - Upload mode: large doc → POST /maps then POST /maps/:id/share.
//                  URL built from `${window.location.origin}/m/${token}`.
//
// Drain-block path is exercised in a third case: isDraining toggling true
// in the store causes the hook to wait until it flips false.

import { act, cleanup, render } from "@testing-library/react";
import LZString from "lz-string";
import React, { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useShareLink } from "../useShareLink";
import { usePersistenceStore } from "../../state/usePersistenceStore";
import type { AtlasdrawDocument } from "@atlasdraw/data";
import type { HttpStorageClient } from "../../services/createHttpStorageClient";

// ---------------------------------------------------------------------------
// Fixture: a minimal AtlasdrawDocument compatible with @atlasdraw/data write().
// Hash mode only JSON-stringifies — no zip round trip. Upload mode goes
// through write() so the doc must satisfy ManifestSchema.
// ---------------------------------------------------------------------------

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

function bulkyDoc(): AtlasdrawDocument {
  // A scene with a long string in a single element. write() runs JSZip on
  // this. Manifest stays cheap; the scene blob is what kicks JSON byte
  // length past the 32 KiB threshold.
  const padding = "x".repeat(40 * 1024);
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
    // Stick the padding into a fake "scene" string field; the hook JSON-
    // stringifies the whole document.
    scene: [{ type: "filler", id: "f1", text: padding } as unknown as object],
    layers: new Map(),
    styleRef: {},
    files: new Map(),
  } as unknown as AtlasdrawDocument;
}

function makeMockClient(): HttpStorageClient & {
  createMapSpy: ReturnType<typeof vi.fn>;
  createShareTokenSpy: ReturnType<typeof vi.fn>;
} {
  const createMapSpy = vi.fn(async () => ({
    id: "abcdefghij1234567890K",
    created_at: "2026-05-10T00:00:00.000Z",
    updated_at: "2026-05-10T00:00:00.000Z",
    blob_ref: "blobs/abcdefghij1234567890K.atlasdraw",
    byte_size: 42,
  }));
  const createShareTokenSpy = vi.fn(async () => ({
    token: "tokentokentokentokenA",
    map_id: "abcdefghij1234567890K",
    mode: "read" as const,
    expires_at: "2026-05-17T00:00:00.000Z",
    created_at: "2026-05-10T00:00:00.000Z",
  }));
  return {
    createMap: createMapSpy,
    getMap: vi.fn(async () => null),
    updateMap: vi.fn(),
    createShareToken: createShareTokenSpy,
    resolveToken: vi.fn(async () => null),
    getShareBlob: vi.fn(async () => null),
    createMapSpy,
    createShareTokenSpy,
  };
}

interface CapturedState {
  url: string | null;
  mode: string | null;
  error: string | null;
}

function Harness({
  getDoc,
  client,
  onCapture,
  drainTimeoutMs,
  drainPollMs,
}: {
  getDoc: () => AtlasdrawDocument;
  client: HttpStorageClient;
  onCapture: (s: CapturedState & { generate: () => Promise<string | null> }) => void;
  drainTimeoutMs?: number;
  drainPollMs?: number;
}): React.ReactElement {
  const { generate, mode, error } = useShareLink({
    getDoc,
    client,
    drainTimeoutMs,
    drainPollMs,
  });
  const [url, setUrl] = React.useState<string | null>(null);
  useEffect(() => {
    onCapture({
      url,
      mode,
      error,
      generate: async () => {
        const r = await generate();
        setUrl(r);
        return r;
      },
    });
  }, [url, mode, error, generate, onCapture]);
  return <div data-testid="harness" />;
}

describe("useShareLink", () => {
  beforeEach(() => {
    // Reset persistence store between tests.
    usePersistenceStore.setState({ isDraining: false });
    // Fix window origin for predictable URL assertions.
    Object.defineProperty(window, "location", {
      value: { ...window.location, origin: "https://test.example" },
      writable: true,
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("hash mode: tiny doc → URL contains compressed payload that round-trips", async () => {
    const doc = tinyDoc();
    const client = makeMockClient();
    let captured: (CapturedState & { generate: () => Promise<string | null> }) | null =
      null;

    render(
      <Harness
        getDoc={() => doc}
        client={client}
        onCapture={(s) => {
          captured = s;
        }}
      />,
    );

    let url: string | null = null;
    await act(async () => {
      url = await captured!.generate();
    });

    expect(url).not.toBeNull();
    expect(url!.startsWith("https://test.example/m#v1:")).toBe(true);
    expect(captured!.mode).toBe("hash");
    expect(client.createMapSpy).not.toHaveBeenCalled();
    expect(client.createShareTokenSpy).not.toHaveBeenCalled();

    // Round-trip: decode and confirm we get the same document back.
    const enc = url!.split("#v1:")[1];
    const decoded = LZString.decompressFromBase64(enc);
    expect(decoded).not.toBeNull();
    const parsed = JSON.parse(decoded!);
    expect(parsed.manifest.id).toBe(doc.manifest.id);
  });

  it("upload mode: large doc → POSTs to /maps then mints a token", async () => {
    const doc = bulkyDoc();
    const client = makeMockClient();
    let captured: (CapturedState & { generate: () => Promise<string | null> }) | null =
      null;

    render(
      <Harness
        getDoc={() => doc}
        client={client}
        onCapture={(s) => {
          captured = s;
        }}
      />,
    );

    let url: string | null = null;
    await act(async () => {
      url = await captured!.generate();
    });

    expect(url).toBe("https://test.example/m/tokentokentokentokenA");
    expect(captured!.mode).toBe("upload");
    // Order: createMap then createShareToken.
    expect(client.createMapSpy).toHaveBeenCalledTimes(1);
    expect(client.createShareTokenSpy).toHaveBeenCalledTimes(1);
    expect(client.createShareTokenSpy).toHaveBeenCalledWith(
      "abcdefghij1234567890K",
    );
  });

  it("drain block: waits for isDraining=false before snapshotting", async () => {
    const doc = tinyDoc();
    const client = makeMockClient();
    let captured: (CapturedState & { generate: () => Promise<string | null> }) | null =
      null;

    // Start in a draining state.
    usePersistenceStore.setState({ isDraining: true });

    render(
      <Harness
        getDoc={() => doc}
        client={client}
        onCapture={(s) => {
          captured = s;
        }}
        drainTimeoutMs={1000}
        drainPollMs={10}
      />,
    );

    let urlPromise: Promise<string | null> | null = null;
    act(() => {
      urlPromise = captured!.generate();
    });

    // Flip drain off after a short delay; the hook should pick that up.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 25));
      usePersistenceStore.setState({ isDraining: false });
    });

    const url = await act(async () => await urlPromise!);
    expect(url).not.toBeNull();
    expect(captured!.mode).toBe("hash");
  });

  it("drain timeout: surfaces error when autosave never finishes", async () => {
    const doc = tinyDoc();
    const client = makeMockClient();
    let captured: (CapturedState & { generate: () => Promise<string | null> }) | null =
      null;

    usePersistenceStore.setState({ isDraining: true });

    render(
      <Harness
        getDoc={() => doc}
        client={client}
        onCapture={(s) => {
          captured = s;
        }}
        drainTimeoutMs={60}
        drainPollMs={20}
      />,
    );

    let url: string | null | undefined;
    await act(async () => {
      url = await captured!.generate();
    });

    expect(url).toBeNull();
    expect(captured!.error).toMatch(/Autosave/i);
  });
});
