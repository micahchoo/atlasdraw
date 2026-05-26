// SPDX-License-Identifier: AGPL-3.0-only
// Phase 4 T8/T9 — App path-detection tests.
//
// Verify the path-detection switch in App.tsx routes correctly between
// MapEditor (default) and ShareView (`/m...` paths). We mock both children
// down to sentinels so we don't need the full Excalidraw + MapLibre stack
// in jsdom; the test is purely about routing.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { App } from "../App";

vi.mock("../components/MapEditor", () => ({
  MapEditor: () => <div data-testid="route-map-editor" />,
}));
vi.mock("../components/ShareView", () => ({
  ShareView: () => <div data-testid="route-share-view" />,
}));
// Phase 6 A13a — BillingPage is rendered by App at `/billing`. Mock it to a
// sentinel that surfaces the `workspaceId` prop so we can verify the route
// honors `?workspaceId=` query (the bridge MapEditor's Upgrade button uses).
vi.mock("../components/BillingPage", () => ({
  BillingPage: ({ workspaceId }: { workspaceId: string | null }) => (
    <div
      data-testid="route-billing-page"
      data-workspace-id={workspaceId ?? ""}
    />
  ),
}));

function setLocation(
  pathname: string,
  hash: string,
  search: string = "",
): void {
  Object.defineProperty(window, "location", {
    value: { ...window.location, pathname, hash, search },
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

  it("renders BillingPage on /billing", () => {
    setLocation("/billing", "");
    render(<App />);
    expect(screen.queryByTestId("route-billing-page")).not.toBeNull();
    expect(screen.queryByTestId("route-map-editor")).toBeNull();
  });

  it("threads ?workspaceId= into BillingPage so the upgrade survives the hop", () => {
    setLocation("/billing", "", "?workspaceId=ws-alpha");
    render(<App />);
    const node = screen.getByTestId("route-billing-page");
    expect(node.getAttribute("data-workspace-id")).toBe("ws-alpha");
  });
});
