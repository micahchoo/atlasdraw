// SPDX-License-Identifier: AGPL-3.0-only
//
// The status bar's credit line: the basemap's credit, then each visible tile
// layer's. It follows the open document.

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { currentDocument } from "../../state/document";
import { StatusBar } from "../StatusBar";

afterEach(cleanup);

const credit = () => screen.getByTestId("status-bar-attribution").textContent;

describe("StatusBar credit", () => {
  it("adds a tile layer's credit, and drops it when the layer is hidden", () => {
    currentDocument().dispatch({ type: "set-basemap", id: "osm-standard" });
    render(<StatusBar map={null} />);
    expect(credit()).toBe("© OpenStreetMap contributors");

    act(() =>
      currentDocument().dispatch({
        type: "add-tile-layer",
        id: "tl:aerial",
        label: "Aerial",
        url: "https://tiles.example.org/{z}/{x}/{y}.png",
        attribution: "© Example Aerials",
      }),
    );
    expect(credit()).toBe("© OpenStreetMap contributors · © Example Aerials");

    act(() =>
      currentDocument().dispatch({
        type: "set-visibility",
        id: "tl:aerial",
        visible: false,
      }),
    );
    expect(credit()).toBe("© OpenStreetMap contributors");
  });

  it("follows the basemap the document chooses", () => {
    currentDocument().dispatch({ type: "set-basemap", id: "protomaps-dark" });
    render(<StatusBar map={null} />);
    expect(credit()).toBe("© Protomaps © OpenStreetMap");
    act(() =>
      currentDocument().dispatch({
        type: "set-basemap",
        id: "openfreemap-bright",
      }),
    );
    expect(credit()).toBe("© OpenFreeMap © OpenMapTiles © OpenStreetMap");
  });
});
