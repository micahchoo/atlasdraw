// SPDX-License-Identifier: AGPL-3.0-only
// Phase 6 A13a — listWorkspaces + createCheckoutSession tests.
//
// Verifies the two new managed-mode methods on HttpStorageClient:
//   - Self-host short-circuit (no workspace resolver → no network call).
//   - Managed mode (resolver returns id → GET / POST as expected).
//
// Mirrors the existing createHttpStorageClient.test.ts fetch-stub pattern.

import { describe, expect, it, vi } from "vitest";

import {
  createHttpStorageClient,
  type WorkspaceSummary,
} from "../createHttpStorageClient";

const SAMPLE: WorkspaceSummary[] = [
  { id: "ws-alpha", name: "Alpha", plan: "free" },
  { id: "ws-beta", name: "Beta", plan: "pro" },
];

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("listWorkspaces", () => {
  it("returns [] in self-host without making a network call", async () => {
    const fetchSpy = vi.fn(
      async () => jsonResponse(200, SAMPLE),
    ) as unknown as typeof fetch;

    // No getWorkspaceId resolver — emulates the FOSS edition.
    const client = createHttpStorageClient({
      baseUrl: "http://localhost:4000",
      fetch: fetchSpy,
    });
    const result = await client.listWorkspaces();
    expect(result).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns [] when the resolver yields null (managed off)", async () => {
    const fetchSpy = vi.fn(
      async () => jsonResponse(200, SAMPLE),
    ) as unknown as typeof fetch;
    const client = createHttpStorageClient({
      baseUrl: "http://localhost:4000",
      fetch: fetchSpy,
      getWorkspaceId: () => null,
    });
    expect(await client.listWorkspaces()).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("GETs /api/workspaces with the X-Workspace-ID header in managed mode", async () => {
    const fetchSpy = vi.fn(async (url: unknown, init: unknown) => {
      expect(url).toBe("http://localhost:4000/api/workspaces");
      const i = init as RequestInit;
      expect(i.method).toBe("GET");
      const headers = i.headers as Record<string, string>;
      expect(headers["X-Workspace-ID"]).toBe("ws-alpha");
      return jsonResponse(200, SAMPLE);
    }) as unknown as typeof fetch;

    const client = createHttpStorageClient({
      baseUrl: "http://localhost:4000",
      fetch: fetchSpy,
      getWorkspaceId: () => "ws-alpha",
    });
    const result = await client.listWorkspaces();
    expect(result).toEqual(SAMPLE);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("propagates 5xx as a thrown error with operation name", async () => {
    const fetchSpy = vi.fn(
      async () =>
        new Response("boom", { status: 500, statusText: "Server Error" }),
    ) as unknown as typeof fetch;
    const client = createHttpStorageClient({
      baseUrl: "http://localhost:4000",
      fetch: fetchSpy,
      getWorkspaceId: () => "ws-alpha",
    });
    await expect(client.listWorkspaces()).rejects.toThrow(
      /listWorkspaces.*500/,
    );
  });
});

describe("createCheckoutSession", () => {
  it("POSTs to /api/checkout-session and returns the redirect URL", async () => {
    const fetchSpy = vi.fn(async (url: unknown, init: unknown) => {
      expect(url).toBe("http://localhost:4000/api/checkout-session");
      const i = init as RequestInit;
      expect(i.method).toBe("POST");
      const headers = i.headers as Record<string, string>;
      expect(headers["X-Workspace-ID"]).toBe("ws-beta");
      expect(headers["Content-Type"]).toBe("application/json");
      expect(typeof i.body).toBe("string");
      const parsed = JSON.parse(i.body as string);
      expect(parsed).toEqual({ workspaceId: "ws-beta", priceTier: "pro" });
      return jsonResponse(200, { url: "https://stripe.test/session/xyz" });
    }) as unknown as typeof fetch;

    const client = createHttpStorageClient({
      baseUrl: "http://localhost:4000",
      fetch: fetchSpy,
      getWorkspaceId: () => "ws-beta",
    });
    const result = await client.createCheckoutSession({
      workspaceId: "ws-beta",
      priceTier: "pro",
    });
    expect(result).toEqual({ url: "https://stripe.test/session/xyz" });
  });

  it("throws in self-host (no resolver) instead of making a request", async () => {
    const fetchSpy = vi.fn(
      async () => jsonResponse(200, { url: "should-not-reach" }),
    ) as unknown as typeof fetch;
    const client = createHttpStorageClient({
      baseUrl: "http://localhost:4000",
      fetch: fetchSpy,
    });
    await expect(
      client.createCheckoutSession({
        workspaceId: "ws-alpha",
        priceTier: "pro",
      }),
    ).rejects.toThrow(/self-host/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
