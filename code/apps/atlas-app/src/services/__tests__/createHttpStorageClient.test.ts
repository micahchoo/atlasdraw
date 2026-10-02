// SPDX-License-Identifier: AGPL-3.0-only
// HTTP storage client tests.
//
// All tests stub `fetch` via vi.fn() and inject through the constructor's
// `fetch` option. No real network — and no global mutation that could
// race with other parallel tests in the same vitest pool.

import { describe, expect, it, vi } from "vitest";

import {
  createHttpStorageClient,
  MapChangedError,
  ShareExpiredError,
  StorageHttpError,
  type MapRecord,
} from "../createHttpStorageClient";

const SAMPLE_MAP: MapRecord = {
  id: "abcdefghij1234567890K",
  created_at: "2026-05-10T00:00:00.000Z",
  updated_at: "2026-05-10T00:00:00.000Z",
  byte_size: 8,
  revision: 1,
};
const KEY = "k".repeat(43);
const TOKEN = "tokentokentokentokenA";

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const emptyResponse = (status: number): Response =>
  new Response("", { status });

function headersOf(init: unknown): Record<string, string> {
  return ((init as RequestInit).headers ?? {}) as Record<string, string>;
}

describe("createHttpStorageClient", () => {
  it("createMap POSTs octet-stream and returns the map and its write key", async () => {
    const fetchSpy = vi.fn(async (url: unknown, init: unknown) => {
      expect(url).toBe("http://localhost:4000/maps");
      expect((init as RequestInit).method).toBe("POST");
      expect(headersOf(init)["Content-Type"]).toBe("application/octet-stream");
      expect(headersOf(init).Authorization).toBeUndefined();
      return jsonResponse(201, { ...SAMPLE_MAP, write_key: KEY });
    }) as unknown as typeof fetch;

    const client = createHttpStorageClient({
      baseUrl: "http://localhost:4000",
      fetch: fetchSpy,
    });
    const created = await client.createMap(new Blob([new Uint8Array(4)]));

    expect(created).toEqual({ map: SAMPLE_MAP, writeKey: KEY });
  });

  it("updateMap PUTs to /maps/:id with the write key", async () => {
    const updated: MapRecord = { ...SAMPLE_MAP, byte_size: 16 };
    const fetchSpy = vi.fn(async (url: unknown, init: unknown) => {
      expect(url).toBe(`http://localhost:4000/maps/${SAMPLE_MAP.id}`);
      expect((init as RequestInit).method).toBe("PUT");
      expect(headersOf(init).Authorization).toBe(`Bearer ${KEY}`);
      return jsonResponse(200, updated);
    }) as unknown as typeof fetch;

    const client = createHttpStorageClient({
      baseUrl: "http://localhost:4000",
      fetch: fetchSpy,
    });
    const record = await client.updateMap(
      SAMPLE_MAP.id,
      KEY,
      new Blob([new Uint8Array(16)]),
    );
    expect(record).toEqual(updated);
  });

  it("updateMap throws a StorageHttpError that carries the status", async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(403, { error: "write key does not match" }),
    ) as unknown as typeof fetch;
    const client = createHttpStorageClient({ baseUrl: "", fetch: fetchSpy });

    const err = await client
      .updateMap(SAMPLE_MAP.id, KEY, new Blob(["x"]))
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(StorageHttpError);
    expect((err as StorageHttpError).status).toBe(403);
  });

  it("updateMap names the revision it replaces, and asks for a checkpoint", async () => {
    const fetchSpy = vi.fn(async (url: unknown, init: unknown) => {
      expect(url).toBe(`/maps/${SAMPLE_MAP.id}?checkpoint=1`);
      expect(headersOf(init)["If-Match"]).toBe('"4"');
      return jsonResponse(200, { ...SAMPLE_MAP, revision: 5 });
    }) as unknown as typeof fetch;
    const client = createHttpStorageClient({ baseUrl: "", fetch: fetchSpy });

    const record = await client.updateMap(SAMPLE_MAP.id, KEY, new Blob(["x"]), {
      ifRevision: 4,
      checkpoint: true,
    });

    expect(record.revision).toBe(5);
  });

  it("updateMap sends no If-Match when it knows no revision", async () => {
    const fetchSpy = vi.fn(async (url: unknown, init: unknown) => {
      expect(url).toBe(`/maps/${SAMPLE_MAP.id}`);
      expect(headersOf(init)["If-Match"]).toBeUndefined();
      return jsonResponse(200, SAMPLE_MAP);
    }) as unknown as typeof fetch;
    const client = createHttpStorageClient({ baseUrl: "", fetch: fetchSpy });

    await client.updateMap(SAMPLE_MAP.id, KEY, new Blob(["x"]));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("updateMap throws MapChangedError with the server's revision on 412", async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(412, { error: "changed", revision: 9 }),
    ) as unknown as typeof fetch;
    const client = createHttpStorageClient({ baseUrl: "", fetch: fetchSpy });

    const err = await client
      .updateMap(SAMPLE_MAP.id, KEY, new Blob(["x"]), { ifRevision: 4 })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(MapChangedError);
    expect((err as MapChangedError).status).toBe(412);
    expect((err as MapChangedError).revision).toBe(9);
  });

  it("readMap GETs the owner's backup with the write key, and its revision", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const fetchSpy = vi.fn(async (url: unknown, init: unknown) => {
      expect(url).toBe(`/maps/${SAMPLE_MAP.id}/blob`);
      expect(headersOf(init).Authorization).toBe(`Bearer ${KEY}`);
      return new Response(bytes, { status: 200, headers: { ETag: '"3"' } });
    }) as unknown as typeof fetch;
    const client = createHttpStorageClient({ baseUrl: "", fetch: fetchSpy });

    const back = await client.readMap(SAMPLE_MAP.id, KEY);

    expect(new Uint8Array(back.bytes)).toEqual(bytes);
    expect(back.revision).toBe(3);
  });

  it("listVersions GETs the map's revisions with the write key", async () => {
    const fetchSpy = vi.fn(async (url: unknown, init: unknown) => {
      expect(url).toBe(`/maps/${SAMPLE_MAP.id}/versions`);
      expect(headersOf(init).Authorization).toBe(`Bearer ${KEY}`);
      return jsonResponse(200, {
        current: 3,
        versions: [
          { revision: 3, saved_at: "2026-10-01T10:00:00.000Z", byte_size: 9 },
          { revision: 1, saved_at: "2026-10-01T09:00:00.000Z", byte_size: 8 },
        ],
      });
    }) as unknown as typeof fetch;
    const client = createHttpStorageClient({ baseUrl: "", fetch: fetchSpy });

    const history = await client.listVersions(SAMPLE_MAP.id, KEY);

    expect(history).toEqual({
      current: 3,
      versions: [
        { revision: 3, savedAt: "2026-10-01T10:00:00.000Z", byteSize: 9 },
        { revision: 1, savedAt: "2026-10-01T09:00:00.000Z", byteSize: 8 },
      ],
    });
  });

  it("readVersion GETs one revision's bytes with the write key", async () => {
    const fetchSpy = vi.fn(async (url: unknown, init: unknown) => {
      expect(url).toBe(`/maps/${SAMPLE_MAP.id}/versions/2/blob`);
      expect(headersOf(init).Authorization).toBe(`Bearer ${KEY}`);
      return new Response(new Uint8Array([2]), {
        status: 200,
        headers: { ETag: '"2"' },
      });
    }) as unknown as typeof fetch;
    const client = createHttpStorageClient({ baseUrl: "", fetch: fetchSpy });

    const back = await client.readVersion(SAMPLE_MAP.id, KEY, 2);

    expect(new Uint8Array(back.bytes)).toEqual(new Uint8Array([2]));
    expect(back.revision).toBe(2);
  });

  it("createShareToken freezes a link on a revision", async () => {
    const fetchSpy = vi.fn(async (_url: unknown, init: unknown) => {
      expect(JSON.parse(String((init as RequestInit).body))).toEqual({
        revision: 4,
      });
      return jsonResponse(201, {
        token: TOKEN,
        url: `/m/${TOKEN}`,
        expires_at: null,
        revision: 4,
      });
    }) as unknown as typeof fetch;
    const client = createHttpStorageClient({ baseUrl: "", fetch: fetchSpy });

    const link = await client.createShareToken(SAMPLE_MAP.id, KEY, null, 4);

    expect(link).toEqual({ token: TOKEN, expiresAt: null, revision: 4 });
  });

  it("createShareToken sends the key and no body for a lasting link", async () => {
    const fetchSpy = vi.fn(async (url: unknown, init: unknown) => {
      expect(url).toBe(`/maps/${SAMPLE_MAP.id}/share`);
      expect((init as RequestInit).method).toBe("POST");
      expect(headersOf(init).Authorization).toBe(`Bearer ${KEY}`);
      expect((init as RequestInit).body).toBeUndefined();
      return jsonResponse(201, {
        token: TOKEN,
        url: `/m/${TOKEN}`,
        expires_at: null,
      });
    }) as unknown as typeof fetch;
    const client = createHttpStorageClient({ baseUrl: "", fetch: fetchSpy });

    expect(await client.createShareToken(SAMPLE_MAP.id, KEY, null)).toEqual({
      token: TOKEN,
      expiresAt: null,
      revision: null,
    });
  });

  it("createShareToken sends an expiry as JSON when one is asked", async () => {
    const fetchSpy = vi.fn(async (_url: unknown, init: unknown) => {
      expect(headersOf(init)["Content-Type"]).toBe("application/json");
      expect(JSON.parse((init as RequestInit).body as string)).toEqual({
        expires_in_days: 7,
      });
      return jsonResponse(201, {
        token: TOKEN,
        url: `/m/${TOKEN}`,
        expires_at: "2026-05-17T00:00:00.000Z",
      });
    }) as unknown as typeof fetch;
    const client = createHttpStorageClient({ baseUrl: "", fetch: fetchSpy });

    const share = await client.createShareToken(SAMPLE_MAP.id, KEY, 7);

    expect(share.expiresAt).toBe("2026-05-17T00:00:00.000Z");
  });

  it("revokeShareToken DELETEs the token with the key", async () => {
    const fetchSpy = vi.fn(async (url: unknown, init: unknown) => {
      expect(url).toBe(`/maps/${SAMPLE_MAP.id}/share/${TOKEN}`);
      expect((init as RequestInit).method).toBe("DELETE");
      expect(headersOf(init).Authorization).toBe(`Bearer ${KEY}`);
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    const client = createHttpStorageClient({ baseUrl: "", fetch: fetchSpy });

    await expect(
      client.revokeShareToken(SAMPLE_MAP.id, KEY, TOKEN),
    ).resolves.toBeUndefined();
  });

  it("deleteMap DELETEs the map with the key", async () => {
    const fetchSpy = vi.fn(async (url: unknown, init: unknown) => {
      expect(url).toBe(`/maps/${SAMPLE_MAP.id}`);
      expect((init as RequestInit).method).toBe("DELETE");
      expect(headersOf(init).Authorization).toBe(`Bearer ${KEY}`);
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    const client = createHttpStorageClient({ baseUrl: "", fetch: fetchSpy });

    await expect(client.deleteMap(SAMPLE_MAP.id, KEY)).resolves.toBeUndefined();
  });

  it("propagates network errors from fetch (rejection bubbles up)", async () => {
    const boom = new Error("network down");
    const fetchSpy = vi.fn(async () => {
      throw boom;
    }) as unknown as typeof fetch;
    const client = createHttpStorageClient({
      baseUrl: "http://localhost:4000",
      fetch: fetchSpy,
    });
    await expect(client.createMap(new Blob([new Uint8Array(4)]))).rejects.toBe(
      boom,
    );
  });

  it("createMap throws on 5xx with status code in the message", async () => {
    const fetchSpy = vi.fn(
      async () =>
        new Response("server boom", {
          status: 500,
          statusText: "Internal Server Error",
        }),
    ) as unknown as typeof fetch;
    const client = createHttpStorageClient({
      baseUrl: "http://localhost:4000",
      fetch: fetchSpy,
    });
    await expect(
      client.createMap(new Blob([new Uint8Array(4)])),
    ).rejects.toThrow(/createMap.*500/);
  });

  it("supports same-origin baseUrl (empty string) — path-only URL", async () => {
    const fetchSpy = vi.fn(async (url: unknown) => {
      expect(url).toBe("/maps");
      return jsonResponse(201, { ...SAMPLE_MAP, write_key: KEY });
    }) as unknown as typeof fetch;
    const client = createHttpStorageClient({ baseUrl: "", fetch: fetchSpy });
    await client.createMap(new Blob([new Uint8Array(4)]));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  // getShareBlob (HTTP-only helper).
  describe("getShareBlob", () => {
    it("returns the ArrayBuffer on 200 with octet-stream payload", async () => {
      const bytes = new Uint8Array([0xa1, 0xb2, 0xc3, 0xd4]);
      const fetchSpy = vi.fn(async (url: unknown) => {
        expect(url).toBe(`http://localhost:4000/share/${TOKEN}/blob`);
        return new Response(bytes, {
          status: 200,
          headers: { "Content-Type": "application/octet-stream" },
        });
      }) as unknown as typeof fetch;

      const client = createHttpStorageClient({
        baseUrl: "http://localhost:4000",
        fetch: fetchSpy,
      });
      const buf = await client.getShareBlob(TOKEN);
      expect(buf).not.toBeNull();
      expect(new Uint8Array(buf!)).toEqual(bytes);
    });

    it("returns null on 404 (token never existed)", async () => {
      const fetchSpy = vi.fn(async () =>
        emptyResponse(404),
      ) as unknown as typeof fetch;
      const client = createHttpStorageClient({
        baseUrl: "http://localhost:4000",
        fetch: fetchSpy,
      });
      expect(await client.getShareBlob(TOKEN)).toBeNull();
    });

    it("throws ShareExpiredError on 410", async () => {
      const fetchSpy = vi.fn(async () =>
        emptyResponse(410),
      ) as unknown as typeof fetch;
      const client = createHttpStorageClient({
        baseUrl: "http://localhost:4000",
        fetch: fetchSpy,
      });
      await expect(client.getShareBlob(TOKEN)).rejects.toBeInstanceOf(
        ShareExpiredError,
      );
    });

    it("throws on 5xx with operation name in the message", async () => {
      const fetchSpy = vi.fn(
        async () =>
          new Response("boom", {
            status: 500,
            statusText: "Internal Server Error",
          }),
      ) as unknown as typeof fetch;
      const client = createHttpStorageClient({
        baseUrl: "http://localhost:4000",
        fetch: fetchSpy,
      });
      await expect(client.getShareBlob(TOKEN)).rejects.toThrow(
        /getShareBlob.*500/,
      );
    });
  });
});
