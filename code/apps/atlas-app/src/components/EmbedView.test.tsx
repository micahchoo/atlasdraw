// SPDX-License-Identifier: AGPL-3.0-only
// The read-only viewer: what it shows for each link, in each chrome. The map
// layer (@atlasdraw/basemap) and Excalidraw are stubbed, so `map` stays null;
// the e2e known-red.spec.ts checks the real map and the drawing on it.
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import LZString from "lz-string";

import { write } from "@atlasdraw/data";

import {
  savedDocument,
  savedManifest,
} from "../state/__tests__/fixtures/documentWorld";
import {
  ShareExpiredError,
  type HttpStorageClient,
} from "../services/createHttpStorageClient";
import { buildRoute, type SharedMap } from "../routes";

import { EmbedView } from "./EmbedView";

vi.mock("@atlasdraw/excalidraw", () => ({
  Excalidraw: () => null,
}));

vi.mock("@atlasdraw/basemap", async () => ({
  // The real basemap definitions: the credit is data on them.
  getBasemap: (await import("@atlasdraw/basemap/src/BasemapRegistry"))
    .getBasemap,
  MapCanvas: () =>
    React.createElement("div", { "data-testid": "map-canvas-stub" }),
  registerPmtilesProtocol: vi.fn(),
  resolveStyle: vi.fn(() =>
    Promise.resolve({ version: 8, sources: {}, layers: [] }),
  ),
  BasemapRemoteGatedError: class BasemapRemoteGatedError extends Error {},
  CameraBridge: class {
    attach() {}
    detach() {}
    push() {}
  },
}));

afterEach(cleanup);

const TOKEN = "abcdefghij1234567890K";

const hashMap = (doc: unknown): SharedMap => ({
  hash: `v1:${LZString.compressToBase64(JSON.stringify(doc))}`,
});

// A link made before v2: the manifest and the drawing, as JSON.
const mapDoc = {
  manifest: savedManifest({
    title: "Wells of the Thar",
    basemap: { type: "registry", id: "openfreemap-bright" },
    camera: { center: [-122.42, 37.77], zoom: 12, bearing: 0, pitch: 0 },
    layers: [],
  }),
  scene: [],
};

function stubClient(
  getShareBlob: HttpStorageClient["getShareBlob"],
): HttpStorageClient {
  return { getShareBlob } as unknown as HttpStorageClient;
}

describe("EmbedView", () => {
  it("says a damaged link is invalid", async () => {
    render(<EmbedView chrome="share" map={null} />);
    expect(await screen.findByTestId("viewer-error")).toBeTruthy();
  });

  it("mounts the map stack for a hash link", async () => {
    render(<EmbedView chrome="minimal" map={hashMap(mapDoc)} />);
    expect(await screen.findByTestId("viewer-canvas")).toBeTruthy();
    expect(screen.getByTestId("map-canvas-stub")).toBeTruthy();
  });

  it("prints the basemap's credit and each visible tile layer's credit, as the editor does", async () => {
    // ODbL: the OpenStreetMap credit must be on every map that shows its
    // data, an embed on another site included (audit2-05 H5).
    const withTiles = {
      ...mapDoc,
      manifest: {
        ...mapDoc.manifest,
        tileLayers: [
          {
            kind: "tile",
            id: "tl:a",
            label: "Aerial",
            visible: true,
            opacity: 1,
            url: "https://tiles.example/{z}/{x}/{y}.png",
            attribution: "© Aerial Co",
          },
          {
            kind: "tile",
            id: "tl:b",
            label: "Hidden",
            visible: false,
            opacity: 1,
            url: "https://tiles.example/{z}/{x}/{y}.png",
            attribution: "© Hidden Co",
          },
        ],
      },
    };
    for (const chrome of ["minimal", "share"] as const) {
      render(<EmbedView chrome={chrome} map={hashMap(withTiles)} />);
      const credit = await screen.findByTestId("viewer-credit");
      expect(credit.textContent).toBe(
        "© OpenFreeMap © OpenMapTiles © OpenStreetMap · © Aerial Co",
      );
      cleanup();
    }
  });

  it("minimal chrome shows the map alone", async () => {
    render(<EmbedView chrome="minimal" map={hashMap(mapDoc)} />);
    await screen.findByTestId("viewer-canvas");
    expect(screen.queryByTestId("viewer-head")).toBeNull();
  });

  it("share chrome shows the map's title and a link that opens a copy in the editor", async () => {
    const map = hashMap(mapDoc);
    render(<EmbedView chrome="share" map={map} />);
    await screen.findByTestId("viewer-canvas");
    expect(screen.getByTestId("viewer-head").textContent).toContain(
      "Wells of the Thar",
    );
    const open = screen.getByRole("link", { name: "Open in Atlasdraw" });
    expect(open.getAttribute("href")).toBe(
      buildRoute({ kind: "editor", room: null, open: map }),
    );
  });

  it("reads an upload link through the storage client's share-blob route", async () => {
    const blob = await write(savedDocument({ manifest: mapDoc.manifest }));
    const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(blob);
    });
    const getShareBlob = vi.fn(async () => bytes);
    render(
      <EmbedView
        chrome="share"
        map={{ token: TOKEN }}
        client={stubClient(getShareBlob)}
      />,
    );
    expect(await screen.findByTestId("viewer-canvas")).toBeTruthy();
    expect(getShareBlob).toHaveBeenCalledWith(TOKEN);
    expect(
      screen
        .getByRole("link", { name: "Open in Atlasdraw" })
        .getAttribute("href"),
    ).toBe(buildRoute({ kind: "editor", room: null, open: { token: TOKEN } }));
  });

  it("says when an upload link points at nothing", async () => {
    render(
      <EmbedView
        chrome="share"
        map={{ token: TOKEN }}
        client={stubClient(async () => null)}
      />,
    );
    expect(await screen.findByTestId("viewer-not-found")).toBeTruthy();
  });

  it("says when an upload link has expired", async () => {
    render(
      <EmbedView
        chrome="share"
        map={{ token: TOKEN }}
        client={stubClient(async () => {
          throw new ShareExpiredError();
        })}
      />,
    );
    expect(await screen.findByTestId("viewer-expired")).toBeTruthy();
  });

  it("dispatches with ?lock=1 without error", async () => {
    render(
      <EmbedView chrome="minimal" map={hashMap(mapDoc)} search="?lock=1" />,
    );
    expect(await screen.findByTestId("viewer-canvas")).toBeTruthy();
  });
});
