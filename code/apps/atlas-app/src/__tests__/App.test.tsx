// SPDX-License-Identifier: AGPL-3.0-only
// App routing: which root mounts for a location. The roots are mocked down
// to sentinels; routes.test.ts covers the URL grammar itself.
//
// Every assertion is async because App.tsx loads the route roots through
// React.lazy (see the code-splitting comment there). `findByTestId` waits for
// Suspense to resolve; a synchronous `queryByTestId` would see the null
// fallback and pass or fail for the wrong reason. Check the POSITIVE route
// first, then the negative — before the chunk resolves every sentinel is
// absent, so a bare negative assertion proves nothing.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { App } from "../App";

vi.mock("../components/MapEditor", () => ({
  MapEditor: () => <div data-testid="route-map-editor" />,
}));
vi.mock("../components/ShareView", () => ({
  ShareView: () => <div data-testid="route-share-view" />,
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

  it("renders MapEditor on the root path", async () => {
    setLocation("/", "");
    render(<App />);
    expect(await screen.findByTestId("route-map-editor")).not.toBeNull();
    expect(screen.queryByTestId("route-share-view")).toBeNull();
  });

  it("renders ShareView for /m#v1:<encoded> (hash share)", async () => {
    setLocation("/m", "#v1:abc123");
    render(<App />);
    expect(await screen.findByTestId("route-share-view")).not.toBeNull();
    expect(screen.queryByTestId("route-map-editor")).toBeNull();
  });

  it("renders ShareView for /m/<token> (upload share)", async () => {
    setLocation("/m/abcdefghij1234567890K", "");
    render(<App />);
    expect(await screen.findByTestId("route-share-view")).not.toBeNull();
  });

  it("keeps a damaged /m link on the read-only view, which says so", async () => {
    setLocation("/m", "#something-else");
    render(<App />);
    expect(await screen.findByTestId("route-share-view")).not.toBeNull();
    expect(screen.queryByTestId("route-map-editor")).toBeNull();
  });

  it("renders MapEditor on /billing, which is not a route", async () => {
    setLocation("/billing", "", "?workspaceId=ws-alpha");
    render(<App />);
    expect(await screen.findByTestId("route-map-editor")).not.toBeNull();
  });
});
