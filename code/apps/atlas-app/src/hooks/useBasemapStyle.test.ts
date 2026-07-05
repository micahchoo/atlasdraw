// SPDX-License-Identifier: AGPL-3.0-only
// Tests for useBasemapStyle (ISSUES.md Issue 6 — coverage climb).
//
// Per .claude/rules/test-fixtures.md: this file owns its own mocks.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";

import { useBasemapStyle } from "./useBasemapStyle";

import type maplibregl from "maplibre-gl";

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

function makeMockMap() {
  return {
    setStyle: vi.fn(),
  } as unknown as maplibregl.Map & { setStyle: ReturnType<typeof vi.fn> };
}

beforeEach(() => {
  vi.clearAllMocks();
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
