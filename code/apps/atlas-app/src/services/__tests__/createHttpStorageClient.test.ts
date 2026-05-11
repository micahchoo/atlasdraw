// SPDX-License-Identifier: AGPL-3.0-only
// Phase 4 T13 — HTTP storage client tests.
//
// All tests stub `fetch` via vi.fn() and inject through the constructor's
// `fetch` option. No real network — and no global mutation that could
// race with other parallel tests in the same vitest pool.

import { describe, expect, it, vi } from "vitest";

import {
  createHttpStorageClient,
  ShareExpiredError,
  type MapRecord,
} from "../createHttpStorageClient";

const SAMPLE_MAP: MapRecord = {
  id: "abcdefghij1234567890K",
  created_at: "2026-05-10T00:00:00.000Z",
  updated_at: "2026-05-10T00:00:00.000Z",
  blob_ref: "abcdefghij1234567890K.bin",
  byte_size: 8,
};

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const emptyResponse = (status: number): Response =>
  new Response("", { status });

describe("createHttpStorageClient", () => {
  it("createMap POSTs octet-stream and parses the MapRecord response", async () => {
    const fetchSpy = vi.fn(async (url: unknown, init: unknown) => {
      expect(url).toBe("http://localhost:4000/maps");
      const i = init as RequestInit;
      expect(i.method).toBe("POST");
      expect((i.headers as Record<string, string>)["Content-Type"]).toBe(
        "application/octet-stream",
      );
      expect(i.body).toBeDefined();
      return jsonResponse(201, SAMPLE_MAP);
    }) as unknown as typeof fetch;

    const client = createHttpStorageClient({
      baseUrl: "http://localhost:4000",
      fetch: fetchSpy,
    });
    const blob = new Blob([new Uint8Array([1, 2, 3, 4])]);
    const record = await client.createMap(blob);
    expect(record).toEqual(SAMPLE_MAP);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("updateMap PUTs to /maps/:id and parses the MapRecord response", async () => {
    const updated: MapRecord = { ...SAMPLE_MAP, byte_size: 16 };
    const fetchSpy = vi.fn(async (url: unknown, init: unknown) => {
      expect(url).toBe(`http://localhost:4000/maps/${SAMPLE_MAP.id}`);
      const i = init as RequestInit;
      expect(i.method).toBe("PUT");
      return jsonResponse(200, updated);
    }) as unknown as typeof fetch;

    const client = createHttpStorageClient({
      baseUrl: "http://localhost:4000",
      fetch: fetchSpy,
    });
    const blob = new Blob([new Uint8Array(16)]);
    const record = await client.updateMap(SAMPLE_MAP.id, blob);
    expect(record).toEqual(updated);
  });

  it("getMap returns the MapRecord on 200", async () => {
    const fetchSpy = vi.fn(
      async () => jsonResponse(200, SAMPLE_MAP),
    ) as unknown as typeof fetch;
    const client = createHttpStorageClient({
      baseUrl: "http://localhost:4000",
      fetch: fetchSpy,
    });
    const record = await client.getMap(SAMPLE_MAP.id);
    expect(record).toEqual(SAMPLE_MAP);
  });

  it("getMap returns null on 404 (missing is not an error)", async () => {
    const fetchSpy = vi.fn(
      async () => emptyResponse(404),
    ) as unknown as typeof fetch;
    const client = createHttpStorageClient({
      baseUrl: "http://localhost:4000",
      fetch: fetchSpy,
    });
    const record = await client.getMap(SAMPLE_MAP.id);
    expect(record).toBeNull();
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
    await expect(
      client.createMap(new Blob([new Uint8Array(4)])),
    ).rejects.toBe(boom);
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
      return jsonResponse(201, SAMPLE_MAP);
    }) as unknown as typeof fetch;
    const client = createHttpStorageClient({ baseUrl: "", fetch: fetchSpy });
    await client.createMap(new Blob([new Uint8Array(4)]));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  // Phase 4 T8 amendment — getShareBlob (HTTP-only helper).
  describe("getShareBlob", () => {
    const TOKEN = "abcdefghij1234567890K";

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
      const fetchSpy = vi.fn(
        async () => emptyResponse(404),
      ) as unknown as typeof fetch;
      const client = createHttpStorageClient({
        baseUrl: "http://localhost:4000",
        fetch: fetchSpy,
      });
      expect(await client.getShareBlob(TOKEN)).toBeNull();
    });

    it("throws ShareExpiredError on 410", async () => {
      const fetchSpy = vi.fn(
        async () => emptyResponse(410),
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
