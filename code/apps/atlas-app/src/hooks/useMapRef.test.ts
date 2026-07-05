// SPDX-License-Identifier: AGPL-3.0-only
// Tests for useMapRef (ISSUES.md Issue 6 — coverage climb).
//
// Small hook, but the ref-vs-state split is exactly the kind of thing that's
// easy to get subtly wrong (e.g. reading `map` in an event handler and
// stale-closing over null) — worth pinning down explicitly.
//
// Per .claude/rules/test-fixtures.md: this file owns its own mocks.

import { describe, it, expect, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";

import { useMapRef } from "./useMapRef";

import type maplibregl from "maplibre-gl";

function makeMockMap(): maplibregl.Map {
  return {} as maplibregl.Map;
}

afterEach(() => {
  cleanup();
});

describe("useMapRef", () => {
  it("starts with a null map and a null mapRef.current", () => {
    const { result } = renderHook(() => useMapRef());
    expect(result.current.map).toBeNull();
    expect(result.current.mapRef.current).toBeNull();
  });

  it("onMapReady sets both mapRef.current and the reactive map state", () => {
    const map = makeMockMap();
    const { result } = renderHook(() => useMapRef());

    act(() => {
      result.current.onMapReady(map);
    });

    expect(result.current.map).toBe(map);
    expect(result.current.mapRef.current).toBe(map);
  });

  it("onMapReady keeps a stable function identity across renders", () => {
    const { result, rerender } = renderHook(() => useMapRef());
    const first = result.current.onMapReady;
    rerender();
    expect(result.current.onMapReady).toBe(first);
  });

  it("mapRef keeps the same object identity across renders (stable for imperative reads)", () => {
    const { result, rerender } = renderHook(() => useMapRef());
    const firstRef = result.current.mapRef;
    act(() => {
      result.current.onMapReady(makeMockMap());
    });
    rerender();
    expect(result.current.mapRef).toBe(firstRef);
  });
});
