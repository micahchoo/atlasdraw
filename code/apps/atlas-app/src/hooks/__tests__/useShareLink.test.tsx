// SPDX-License-Identifier: AGPL-3.0-only
//
// useShareLink: a share link carries the whole document, or it is not a hash
// link. The hook measures the encoded `.atlasdraw` bytes, not a JSON string
// of the document (JSON writes the layer and file Maps as {}). A document
// that does not fit goes to its own server map, which later saves update.

import "fake-indexeddb/auto";
import { openDB } from "idb";
import { act, cleanup, render } from "@testing-library/react";
import React, { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CURRENT_MANIFEST_VERSION } from "@atlasdraw/data";

import type { AtlasdrawDocument } from "@atlasdraw/data";

import { useShareLink, type ShareLink } from "../useShareLink";
import { decodeHashDoc } from "../../state/loadShareDocument";

import type { HttpStorageClient } from "../../services/createHttpStorageClient";
import type { FeatureCollection } from "geojson";

const WELLS: FeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { name: "well 1" },
      geometry: { type: "Point", coordinates: [13.4, 52.5] },
    },
  ],
};

function doc(files: Map<string, Blob> = new Map()): AtlasdrawDocument {
  return {
    manifest: {
      id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      version: CURRENT_MANIFEST_VERSION,
      title: "Field notes",
      createdAt: "2026-05-10T00:00:00.000Z",
      updatedAt: "2026-05-10T00:00:00.000Z",
      basemap: { type: "registry", id: "protomaps-light" },
      camera: { center: [13.4, 52.5], zoom: 11, bearing: 0, pitch: 0 },
      world: { z0: 22, origin: { x: 0, y: 0 } },
      layers: [
        {
          kind: "data",
          id: "dl:wells",
          label: "Wells",
          visible: true,
          featureCount: 1,
          style: {},
          source: "data/layer-dl:wells.geojson",
        },
      ],
      permissions: { publicView: false },
    },
    scene: [{ id: "rect-1", type: "rectangle", version: 1 }],
    layers: new Map([["dl:wells", WELLS]]),
    styleRef: {},
    files,
  };
}

/** Bytes DEFLATE cannot shrink: a file the hash cannot hold. */
function noise(bytes: number): Blob {
  const data = new Uint8Array(bytes);
  for (let i = 0; i < bytes; i++) {
    data[i] = (Math.imul(i + 1, 2654435761) >>> 24) & 0xff;
  }
  return new Blob([data], { type: "image/png" });
}

function makeMockClient(opts: { fail?: boolean } = {}): HttpStorageClient & {
  createMapSpy: ReturnType<typeof vi.fn>;
  createShareTokenSpy: ReturnType<typeof vi.fn>;
  revokeShareTokenSpy: ReturnType<typeof vi.fn>;
} {
  const createMapSpy = vi.fn(async () => {
    if (opts.fail) {
      throw new Error("storage is down");
    }
    return {
      map: {
        id: "abcdefghij1234567890K",
        created_at: "2026-05-10T00:00:00.000Z",
        updated_at: "2026-05-10T00:00:00.000Z",
        byte_size: 42,
      },
      writeKey: "write-key",
    };
  });
  const createShareTokenSpy = vi.fn(
    async (_id: string, _key: string, days: number | null) => ({
      token: "tokentokentokentokenA",
      expiresAt: days === null ? null : "2026-05-17T00:00:00.000Z",
    }),
  );
  const revokeShareTokenSpy = vi.fn(async () => {});
  return {
    createMap: createMapSpy,
    updateMap: vi.fn(),
    readMap: vi.fn(),
    createShareToken: createShareTokenSpy,
    revokeShareToken: revokeShareTokenSpy,
    deleteMap: vi.fn(async () => {}),
    getShareBlob: vi.fn(async () => null),
    createMapSpy,
    createShareTokenSpy,
    revokeShareTokenSpy,
  };
}

interface Captured {
  mode: string | null;
  error: string | null;
  generate: (expiresInDays?: number | null) => Promise<ShareLink | null>;
  revoke: (token: string) => Promise<boolean>;
}

function Harness({
  getDoc,
  client,
  onCapture,
}: {
  getDoc: () => AtlasdrawDocument;
  client: HttpStorageClient;
  onCapture: (s: Captured) => void;
}): React.ReactElement {
  const { generate, revoke, mode, error } = useShareLink({ getDoc, client });
  useEffect(() => {
    onCapture({ mode, error, generate, revoke });
  }, [mode, error, generate, revoke, onCapture]);
  return <div data-testid="harness" />;
}

async function share(
  d: AtlasdrawDocument,
  client: HttpStorageClient,
  expiresInDays: number | null = null,
): Promise<{
  url: string | null;
  link: ShareLink | null;
  captured: () => Captured;
}> {
  let captured: Captured | null = null;
  render(
    <Harness
      getDoc={() => d}
      client={client}
      onCapture={(s) => {
        captured = s;
      }}
    />,
  );
  let link: ShareLink | null = null;
  await act(async () => {
    link = await captured!.generate(expiresInDays);
  });
  const got = link as ShareLink | null;
  return { url: got?.url ?? null, link: got, captured: () => captured! };
}

describe("useShareLink", () => {
  beforeEach(async () => {
    // The server map and its key are kept per document in IndexedDB.
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
  });

  it("a small document goes in the hash whole: data layers, files and all", async () => {
    const client = makeMockClient();
    const small = doc(new Map([["img-1", new Blob(["png"])]]));

    const { url, captured } = await share(small, client);

    expect(url?.startsWith("https://test.example/m#v2:")).toBe(true);
    expect(captured().mode).toBe("hash");
    expect(client.createMapSpy).not.toHaveBeenCalled();
    const back = await decodeHashDoc(new URL(url!).hash);
    expect(back.manifest.id).toBe(small.manifest.id);
    expect(back.layers.get("dl:wells")).toEqual(WELLS);
    expect(back.files.has("img-1")).toBe(true);
  });

  it("a document whose encoded bytes do not fit goes to the server", async () => {
    const client = makeMockClient();

    const { url, captured } = await share(
      doc(new Map([["img-1", noise(64 * 1024)]])),
      client,
    );

    expect(url).toBe("https://test.example/m/tokentokentokentokenA");
    expect(captured().mode).toBe("upload");
    expect(client.createShareTokenSpy).toHaveBeenCalledWith(
      "abcdefghij1234567890K",
      "write-key",
      null,
    );
  });

  it("an uploaded link lasts by default and carries the expiry when one is chosen", async () => {
    const big = () => doc(new Map([["img-1", noise(64 * 1024)]]));

    const lasting = await share(big(), makeMockClient());
    cleanup();
    const week = await share(big(), makeMockClient(), 7);

    expect(lasting.link?.expiresAt).toBeNull();
    expect(week.link?.expiresAt).toBe("2026-05-17T00:00:00.000Z");
  });

  it("revoke ends an uploaded link", async () => {
    const client = makeMockClient();
    const { link, captured } = await share(
      doc(new Map([["img-1", noise(64 * 1024)]])),
      client,
    );

    let revoked = false;
    await act(async () => {
      revoked = await captured().revoke(link!.token!);
    });

    expect(revoked).toBe(true);
    expect(client.revokeShareTokenSpy).toHaveBeenCalledWith(
      "abcdefghij1234567890K",
      "write-key",
      "tokentokentokentokenA",
    );
  });

  it("refuses with a message, and drops nothing, when it does not fit and the server fails", async () => {
    const client = makeMockClient({ fail: true });

    const { url, captured } = await share(
      doc(new Map([["img-1", noise(64 * 1024)]])),
      client,
    );

    expect(url).toBeNull();
    expect(captured().mode).toBeNull();
    expect(captured().error).toMatch(/too large/i);
  });
});
