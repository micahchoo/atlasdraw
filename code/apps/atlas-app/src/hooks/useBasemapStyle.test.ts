// SPDX-License-Identifier: AGPL-3.0-only
// Tests for useBasemapStyle.
//
// Per .claude/rules/test-fixtures.md: this file owns its own mocks.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";

import { createDocument, openDocument } from "../state/document";

import { useBasemapStyle } from "./useBasemapStyle";

import type * as maplibregl from "maplibre-gl";

const { registerPmtilesProtocolMock, resolveStyleMock, GatedErrorCtor } =
  vi.hoisted(() => {
    class GatedErrorCtor extends Error {
      basemapId: string;
      constructor(basemapId: string) {
        super(`Basemap ${basemapId} requires allow_remote=true`);
        this.name = "BasemapRemoteGatedError";
        this.basemapId = basemapId;
      }
    }
    return {
      registerPmtilesProtocolMock: vi.fn(),
      resolveStyleMock: vi.fn(),
      GatedErrorCtor,
    };
  });

vi.mock("@atlasdraw/basemap", () => ({
  registerPmtilesProtocol: registerPmtilesProtocolMock,
  resolveStyle: resolveStyleMock,
  BasemapRemoteGatedError: GatedErrorCtor,
}));

const FAKE_STYLE = { version: 8, sources: {}, layers: [] };

type MockMap = maplibregl.Map & {
  setStyle: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  /** Fire every handler currently registered for `event`. */
  fire: (event: string) => void;
  /** How many handlers are live for `event` — leak detector. */
  listenerCount: (event: string) => number;
};

function makeMockMap(): MockMap {
  // Real MapLibre event semantics, minus the once-ness: `on` accumulates and
  // only `off` removes. That is what lets these tests see a leaked listener at
  // all — a stub with `once` semantics would hide a leaked listener.
  const handlers = new Map<string, Array<() => void>>();
  const map = {
    setStyle: vi.fn(),
    on: vi.fn((event: string, handler: () => void) => {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
      return map;
    }),
    off: vi.fn((event: string, handler: () => void) => {
      const list = handlers.get(event) ?? [];
      const i = list.indexOf(handler);
      if (i !== -1) {
        list.splice(i, 1);
      }
      return map;
    }),
    fire: (event: string) => {
      for (const h of [...(handlers.get(event) ?? [])]) {
        h();
      }
    },
    listenerCount: (event: string) => (handlers.get(event) ?? []).length,
  };
  return map as unknown as MockMap;
}

beforeEach(() => {
  vi.clearAllMocks();
  openDocument(createDocument());
  resolveStyleMock.mockResolvedValue(FAKE_STYLE);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useBasemapStyle", () => {
  it("does nothing when map is null", () => {
    renderHook(() => useBasemapStyle(null, "protomaps-light", true));
    expect(registerPmtilesProtocolMock).not.toHaveBeenCalled();
    expect(resolveStyleMock).not.toHaveBeenCalled();
  });

  it("registers the pmtiles protocol and applies the resolved style", async () => {
    const map = makeMockMap();
    renderHook(() => useBasemapStyle(map, "protomaps-light", true));

    await vi.waitFor(() => expect(map.setStyle).toHaveBeenCalledTimes(1));
    expect(registerPmtilesProtocolMock).toHaveBeenCalledTimes(1);
    expect(resolveStyleMock).toHaveBeenCalledWith(
      "protomaps-light",
      expect.objectContaining({ allowRemote: true }),
    );
    expect(map.setStyle).toHaveBeenCalledWith(FAKE_STYLE);
  });

  it("passes allowRemote through to resolveStyle", async () => {
    const map = makeMockMap();
    renderHook(() => useBasemapStyle(map, "openfreemap-bright", false));
    await vi.waitFor(() => expect(resolveStyleMock).toHaveBeenCalled());
    expect(resolveStyleMock).toHaveBeenCalledWith(
      "openfreemap-bright",
      expect.objectContaining({ allowRemote: false }),
    );
  });

  it("swallows BasemapRemoteGatedError with a console.warn, and does not call setStyle", async () => {
    const map = makeMockMap();
    resolveStyleMock.mockRejectedValue(
      new GatedErrorCtor("openfreemap-bright"),
    );
    renderHook(() => useBasemapStyle(map, "openfreemap-bright", false));

    await vi.waitFor(() => expect(console.warn).toHaveBeenCalledTimes(1));
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("openfreemap-bright"),
    );
    expect(map.setStyle).not.toHaveBeenCalled();
  });

  it("logs (not throws) unexpected resolveStyle failures instead of rejecting silently", async () => {
    const map = makeMockMap();
    resolveStyleMock.mockRejectedValue(new Error("network unreachable"));
    renderHook(() => useBasemapStyle(map, "protomaps-light", true));

    await vi.waitFor(() => expect(console.error).toHaveBeenCalledTimes(1));
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("protomaps-light"),
      expect.any(Error),
    );
    expect(map.setStyle).not.toHaveBeenCalled();
  });

  it("re-applies when activeBasemapId changes", async () => {
    const map = makeMockMap();
    const { rerender } = renderHook(
      ({ id }) => useBasemapStyle(map, id, true),
      { initialProps: { id: "protomaps-light" } },
    );
    await vi.waitFor(() => expect(resolveStyleMock).toHaveBeenCalledTimes(1));

    rerender({ id: "protomaps-dark" });
    await vi.waitFor(() => expect(resolveStyleMock).toHaveBeenCalledTimes(2));
    expect(resolveStyleMock).toHaveBeenLastCalledWith(
      "protomaps-dark",
      expect.anything(),
    );
  });
});

describe("useBasemapStyle — switching", () => {
  it("does not apply a stale style when the basemap changed mid-resolve", async () => {
    const map = makeMockMap();
    let releaseFirst: (style: unknown) => void = () => {};
    resolveStyleMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseFirst = resolve;
        }),
    );
    const { rerender } = renderHook(
      ({ id }) => useBasemapStyle(map, id, true),
      { initialProps: { id: "protomaps-light" } },
    );
    rerender({ id: "protomaps-dark" });
    await vi.waitFor(() => expect(map.setStyle).toHaveBeenCalledTimes(1));

    // The abandoned switch finally resolves — it must not overwrite the style
    // the surviving switch already applied.
    releaseFirst({ version: 8, sources: {}, layers: [], stale: true });
    await Promise.resolve();
    expect(map.setStyle).toHaveBeenCalledTimes(1);
    expect(map.setStyle).toHaveBeenCalledWith(FAKE_STYLE);
  });

  it("logs a setStyle failure instead of rejecting silently", async () => {
    const map = makeMockMap();
    map.setStyle.mockImplementationOnce(() => {
      throw new Error("style is not valid");
    });
    renderHook(() => useBasemapStyle(map, "protomaps-light", true));

    await vi.waitFor(() => expect(console.error).toHaveBeenCalledTimes(1));
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("protomaps-light"),
      expect.any(Error),
    );
  });
});
