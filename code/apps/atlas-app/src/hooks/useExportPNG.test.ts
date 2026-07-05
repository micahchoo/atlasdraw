// SPDX-License-Identifier: AGPL-3.0-only
// Tests for useExportPNG (ISSUES.md Issue 6 — coverage climb).
//
// Per .claude/rules/test-fixtures.md: this file owns its own mocks.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";

import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw";

import { useExportPNG } from "./useExportPNG";

import type maplibregl from "maplibre-gl";

const exportPNGMock = vi.fn();
vi.mock("../lib/export", () => ({
  exportPNG: (...args: unknown[]) => exportPNGMock(...args),
}));

const FAKE_BLOB = {} as Blob;

beforeEach(() => {
  vi.clearAllMocks();
  exportPNGMock.mockResolvedValue(FAKE_BLOB);
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: vi.fn(() => "blob:fake-url"),
    revokeObjectURL: vi.fn(),
  });
  vi.spyOn(window, "alert").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useExportPNG", () => {
  it("does nothing when map is null", async () => {
    const api = {} as ExcalidrawImperativeAPI;
    const { result } = renderHook(() => useExportPNG(null, api, "#fff"));
    result.current();
    await Promise.resolve();
    expect(exportPNGMock).not.toHaveBeenCalled();
  });

  it("does nothing when excalidrawAPI is null", async () => {
    const map = {} as maplibregl.Map;
    const { result } = renderHook(() => useExportPNG(map, null, "#fff"));
    result.current();
    await Promise.resolve();
    expect(exportPNGMock).not.toHaveBeenCalled();
  });

  it("exports, downloads via a synthetic anchor, and revokes the object URL", async () => {
    const map = {} as maplibregl.Map;
    const api = {} as ExcalidrawImperativeAPI;
    const clickSpy = vi.fn();
    const realCreateElement = document.createElement.bind(document);
    const createElementSpy = vi
      .spyOn(document, "createElement")
      .mockImplementation((tag: string, opts?: ElementCreationOptions) => {
        if (tag === "a") {
          return {
            click: clickSpy,
            href: "",
            download: "",
          } as unknown as HTMLElement;
        }
        return realCreateElement(tag, opts);
      });

    const { result } = renderHook(() => useExportPNG(map, api, "#123456"));
    result.current();
    await vi.waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(1));

    expect(exportPNGMock).toHaveBeenCalledWith(map, api, {
      backgroundColor: "#123456",
    });
    expect(URL.createObjectURL).toHaveBeenCalledWith(FAKE_BLOB);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:fake-url");
    createElementSpy.mockRestore();
  });

  it("alerts with the error message when exportPNG rejects with an Error", async () => {
    const map = {} as maplibregl.Map;
    const api = {} as ExcalidrawImperativeAPI;
    exportPNGMock.mockRejectedValue(new Error("canvas too large"));
    const realCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(
      (tag: string, opts?: ElementCreationOptions) =>
        tag === "a"
          ? ({ click: vi.fn() } as unknown as HTMLElement)
          : realCreateElement(tag, opts),
    );

    const { result } = renderHook(() => useExportPNG(map, api, "#fff"));
    result.current();

    await vi.waitFor(() => expect(window.alert).toHaveBeenCalledTimes(1));
    expect(window.alert).toHaveBeenCalledWith(
      "PNG export failed: canvas too large",
    );
  });

  it("alerts with a stringified value when exportPNG rejects with a non-Error", async () => {
    const map = {} as maplibregl.Map;
    const api = {} as ExcalidrawImperativeAPI;
    exportPNGMock.mockRejectedValue("weird rejection");

    const { result } = renderHook(() => useExportPNG(map, api, "#fff"));
    result.current();

    await vi.waitFor(() => expect(window.alert).toHaveBeenCalledTimes(1));
    expect(window.alert).toHaveBeenCalledWith(
      "PNG export failed: weird rejection",
    );
  });

  it("keeps a stable callback identity when deps are unchanged", () => {
    const map = {} as maplibregl.Map;
    const api = {} as ExcalidrawImperativeAPI;
    const { result, rerender } = renderHook(
      ({ bg }) => useExportPNG(map, api, bg),
      { initialProps: { bg: "#fff" } },
    );
    const first = result.current;
    rerender({ bg: "#fff" });
    expect(result.current).toBe(first);

    rerender({ bg: "#000" });
    expect(result.current).not.toBe(first);
  });
});
