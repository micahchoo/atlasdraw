// SPDX-License-Identifier: AGPL-3.0-only
// EmbedView dispatch tests. The heavy map layer (@atlasdraw/basemap) is stubbed
// so `map` stays null — useBasemapStyle / useCoordinateSync early-return — and
// this file exercises the load-state dispatch and the ready-state mount. The
// end-to-end map render (basemap + geo-anchored annotations, cross-origin
// iframe) is validated in-browser; see ledgers/PROBE-embed.md.
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import LZString from "lz-string";

import { EmbedView } from "./EmbedView";

// Excalidraw renders a heavy canvas (Path2D, fonts) unavailable in jsdom —
// mock it to a sentinel, matching ShareView.test. The real map+annotation
// composite is validated in-browser (ledgers/PROBE-embed.md).
vi.mock("@atlasdraw/excalidraw", () => ({
  Excalidraw: () => null,
}));

vi.mock("@atlasdraw/basemap", () => ({
  MapCanvas: () =>
    React.createElement("div", { "data-testid": "map-canvas-stub" }),
  registerPmtilesProtocol: vi.fn(),
  resolveStyle: vi.fn(() =>
    Promise.resolve({ version: 8, sources: {}, layers: [] }),
  ),
  BasemapRemoteGatedError: class BasemapRemoteGatedError extends Error {},
  CoordinateSync: class {
    attach() {}
    detach() {}
    syncMapToScene() {}
  },
}));

afterEach(cleanup);

const hashFor = (doc: unknown) =>
  `#v1:${LZString.compressToBase64(JSON.stringify(doc))}`;

const mapDoc = {
  manifest: {
    id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    basemap: { type: "registry", id: "openfreemap-bright" },
    camera: { center: [-122.42, 37.77], zoom: 12 },
    layers: [],
  },
  scene: [],
};

describe("EmbedView", () => {
  it("renders an error for an invalid link", async () => {
    render(<EmbedView location={{ pathname: "/embed", hash: "" }} />);
    expect(await screen.findByTestId("embed-error")).toBeTruthy();
  });

  it("mounts the map stack for a valid hash document", async () => {
    render(
      <EmbedView location={{ pathname: "/embed", hash: hashFor(mapDoc) }} />,
    );
    // Ready → EmbedCanvas mounts the (stubbed) MapCanvas under Excalidraw.
    expect(await screen.findByTestId("embed-canvas")).toBeTruthy();
    expect(screen.getByTestId("map-canvas-stub")).toBeTruthy();
  });
});
