// SPDX-License-Identifier: AGPL-3.0-only
// Tests for useThemeAttribute: Excalidraw's theme sets `data-ad-theme` on
// <html>, which switches every --ad-* token (styles/tokens.css).
//
// Per .claude/rules/test-fixtures.md: this file owns its own mocks.

import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, cleanup, act } from "@testing-library/react";

import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw";

import { useThemeAttribute } from "./useThemeAttribute";

type OnChangeCb = (
  elements: unknown[],
  appState: { theme: string },
  files: unknown,
) => void;

function makeMockAPI(theme: string) {
  let onChangeCb: OnChangeCb | null = null;
  const api = {
    getAppState: vi.fn(() => ({ theme })),
    onChange: vi.fn((cb: OnChangeCb) => {
      onChangeCb = cb;
      return () => {
        onChangeCb = null;
      };
    }),
  } as unknown as ExcalidrawImperativeAPI;
  return {
    api,
    fire: (next: string) => onChangeCb?.([], { theme: next }, undefined),
  };
}

const attribute = () => document.documentElement.getAttribute("data-ad-theme");

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("data-ad-theme");
});

describe("useThemeAttribute", () => {
  it("marks <html> dark from the first render when the drawing is dark", () => {
    const { api } = makeMockAPI("dark");
    renderHook(() => useThemeAttribute(api));
    expect(attribute()).toBe("dark");
  });

  it("follows a theme change, both ways", () => {
    const { api, fire } = makeMockAPI("light");
    renderHook(() => useThemeAttribute(api));
    expect(attribute()).toBeNull();
    act(() => fire("dark"));
    expect(attribute()).toBe("dark");
    act(() => fire("light"));
    expect(attribute()).toBeNull();
  });

  it("leaves no dark mark behind when the editor goes", () => {
    const { api } = makeMockAPI("dark");
    const { unmount } = renderHook(() => useThemeAttribute(api));
    unmount();
    expect(attribute()).toBeNull();
  });
});
