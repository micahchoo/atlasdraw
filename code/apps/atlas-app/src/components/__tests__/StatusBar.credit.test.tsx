// SPDX-License-Identifier: AGPL-3.0-only
//
// The status bar's credit line: the basemap's credit, then each visible tile
// layer's (W9d). It follows the open document.

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { currentDocument } from "../../state/document";
import { StatusBar } from "../StatusBar";

afterEach(cleanup);

const credit = () => screen.getByTestId("status-bar-attribution").textContent;

describe("StatusBar credit", () => {
  it("adds a tile layer's credit, and drops it when the layer is hidden", () => {
    render(<StatusBar map={null} attribution="© OpenStreetMap" />);
    expect(credit()).toBe("© OpenStreetMap");

    act(() =>
      currentDocument().dispatch({
        type: "add-tile-layer",
        id: "tl:aerial",
        label: "Aerial",
        url: "https://tiles.example.org/{z}/{x}/{y}.png",
        attribution: "© Example Aerials",
      }),
    );
    expect(credit()).toBe("© OpenStreetMap · © Example Aerials");

    act(() =>
      currentDocument().dispatch({
        type: "set-visibility",
        id: "tl:aerial",
        visible: false,
      }),
    );
    expect(credit()).toBe("© OpenStreetMap");
  });
});
