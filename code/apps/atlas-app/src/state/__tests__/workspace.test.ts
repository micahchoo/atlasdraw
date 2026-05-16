// SPDX-License-Identifier: AGPL-3.0-only
// atlas-app — Phase 6 A9 workspace state + HTTP client wiring tests.

import { describe, expect, it, vi } from "vitest";
import {
  asWorkspaceId,
  resolveWorkspaceFromEnv,
  workspaceHeaders,
} from "../workspace";
import { createHttpStorageClient } from "../../services/createHttpStorageClient";

describe("workspace state", () => {
  describe("asWorkspaceId", () => {
    it("returns null for null/undefined/empty input", () => {
      expect(asWorkspaceId(null)).toBeNull();
      expect(asWorkspaceId(undefined)).toBeNull();
      expect(asWorkspaceId("")).toBeNull();
    });

    it("brands non-empty strings", () => {
      // Runtime value is identity; the brand is only a compile-time gate.
      expect(asWorkspaceId("ws-1")).toBe("ws-1");
    });
  });

  describe("resolveWorkspaceFromEnv", () => {
    it("returns null id when no env vars present", () => {
      expect(resolveWorkspaceFromEnv({})).toEqual({ id: null });
    });

    it("reads VITE_WORKSPACE_ID first", () => {
      expect(
        resolveWorkspaceFromEnv({ VITE_WORKSPACE_ID: "ws-vite" }),
      ).toEqual({ id: "ws-vite" });
    });

    it("falls back to WORKSPACE_ID", () => {
      expect(
        resolveWorkspaceFromEnv({ WORKSPACE_ID: "ws-fallback" }),
      ).toEqual({ id: "ws-fallback" });
    });
  });

  describe("workspaceHeaders", () => {
    it("returns {} when context id is null", () => {
      expect(workspaceHeaders({ id: null })).toEqual({});
    });

    it("returns X-Workspace-ID when context id is set", () => {
      expect(workspaceHeaders({ id: asWorkspaceId("ws-7")! })).toEqual({
        "X-Workspace-ID": "ws-7",
      });
    });
  });
});

describe("HTTP client workspace wiring", () => {
  function makeFetchSpy(): ReturnType<typeof vi.fn> {
    // Default OK JSON body — every call resolves with a valid MapRecord
    // shape so error paths don't fire.
    return vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: "abcdefghij1234567890K",
          created_at: "2026-05-15T00:00:00.000Z",
          updated_at: "2026-05-15T00:00:00.000Z",
          blob_ref: "x",
          byte_size: 4,
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      ),
    );
  }

  it("attaches X-Workspace-ID when getWorkspaceId resolves non-null", async () => {
    const fetchSpy = makeFetchSpy();
    const client = createHttpStorageClient({
      baseUrl: "http://localhost:4000",
      fetch: fetchSpy as unknown as typeof fetch,
      getWorkspaceId: () => "ws-alpha",
    });

    await client.createMap(new Blob([new Uint8Array(4)]));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0] as [unknown, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Workspace-ID"]).toBe("ws-alpha");
    expect(headers["Content-Type"]).toBe("application/octet-stream");
  });

  it("omits X-Workspace-ID when getWorkspaceId returns null", async () => {
    const fetchSpy = makeFetchSpy();
    const client = createHttpStorageClient({
      baseUrl: "http://localhost:4000",
      fetch: fetchSpy as unknown as typeof fetch,
      getWorkspaceId: () => null,
    });

    await client.createMap(new Blob([new Uint8Array(4)]));

    const [, init] = fetchSpy.mock.calls[0] as [unknown, RequestInit];
    const headers = (init.headers as Record<string, string>) ?? {};
    expect(headers["X-Workspace-ID"]).toBeUndefined();
  });

  it("omits X-Workspace-ID when getWorkspaceId not supplied (default)", async () => {
    const fetchSpy = makeFetchSpy();
    const client = createHttpStorageClient({
      baseUrl: "http://localhost:4000",
      fetch: fetchSpy as unknown as typeof fetch,
    });

    await client.createMap(new Blob([new Uint8Array(4)]));

    const [, init] = fetchSpy.mock.calls[0] as [unknown, RequestInit];
    const headers = (init.headers as Record<string, string>) ?? {};
    expect(headers["X-Workspace-ID"]).toBeUndefined();
  });

  it("resolves workspace per call (runtime switch takes effect)", async () => {
    const fetchSpy = makeFetchSpy();
    let active: string | null = "ws-1";
    const client = createHttpStorageClient({
      baseUrl: "http://localhost:4000",
      fetch: fetchSpy as unknown as typeof fetch,
      getWorkspaceId: () => active,
    });

    await client.createMap(new Blob([new Uint8Array(4)]));
    active = "ws-2";
    await client.createMap(new Blob([new Uint8Array(4)]));

    const first = (fetchSpy.mock.calls[0] as [unknown, RequestInit])[1]
      .headers as Record<string, string>;
    const second = (fetchSpy.mock.calls[1] as [unknown, RequestInit])[1]
      .headers as Record<string, string>;
    expect(first["X-Workspace-ID"]).toBe("ws-1");
    expect(second["X-Workspace-ID"]).toBe("ws-2");
  });

  it("attaches header on GET-only routes (getMap, resolveToken, getShareBlob)", async () => {
    const fetchSpy = vi.fn(async () =>
      new Response("{}", {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const client = createHttpStorageClient({
      baseUrl: "http://localhost:4000",
      fetch: fetchSpy as unknown as typeof fetch,
      getWorkspaceId: () => "ws-z",
    });

    await client.getMap("aaaaaaaaaaaaaaaaaaaaa");
    await client.resolveToken("bbbbbbbbbbbbbbbbbbbbb");
    await client.getShareBlob("ccccccccccccccccccccc");

    for (const call of fetchSpy.mock.calls) {
      const init = (call as unknown as [unknown, RequestInit])[1];
      const headers = init.headers as Record<string, string>;
      expect(headers["X-Workspace-ID"]).toBe("ws-z");
    }
  });
});
