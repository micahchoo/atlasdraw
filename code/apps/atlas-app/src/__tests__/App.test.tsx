// SPDX-License-Identifier: AGPL-3.0-only
// Phase 4 T8/T9 — App path-detection tests.
//
// Verify the path-detection switch in App.tsx routes correctly between
// MapEditor (default) and ShareView (`/m...` paths). We mock both children
// down to sentinels so we don't need the full Excalidraw + MapLibre stack
// in jsdom; the test is purely about routing.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("../components/MapEditor", () => ({
  MapEditor: () => <div data-testid="route-map-editor" />,
}));
vi.mock("../components/ShareView", () => ({
  ShareView: () => <div data-testid="route-share-view" />,
}));

import { App } from "../App";

function setLocation(pathname: string, hash: string): void {
  Object.defineProperty(window, "location", {
    value: { ...window.location, pathname, hash },
    writable: true,
  });
}

describe("App path routing", () => {
  beforeEach(() => {
    setLocation("/", "");
  });
  afterEach(() => {
    cleanup();
  });

  it("renders MapEditor on the root path", () => {
    setLocation("/", "");
    render(<App />);
    expect(screen.queryByTestId("route-map-editor")).not.toBeNull();
    expect(screen.queryByTestId("route-share-view")).toBeNull();
  });

  it("renders ShareView for /m#v1:<encoded> (hash share)", () => {
    setLocation("/m", "#v1:abc123");
    render(<App />);
    expect(screen.queryByTestId("route-share-view")).not.toBeNull();
    expect(screen.queryByTestId("route-map-editor")).toBeNull();
  });

  it("renders ShareView for /m/<token> (upload share)", () => {
    setLocation("/m/abcdefghij1234567890K", "");
    render(<App />);
    expect(screen.queryByTestId("route-share-view")).not.toBeNull();
  });

  it("renders MapEditor for /m without the v1: hash prefix", () => {
    setLocation("/m", "#something-else");
    render(<App />);
    expect(screen.queryByTestId("route-map-editor")).not.toBeNull();
  });
});
