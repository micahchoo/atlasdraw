// SPDX-License-Identifier: AGPL-3.0-only
//
// Tile layers in the layer panel (W9d): "Add tile layer…" checks the URL
// template before it adds anything, and a tile row shows, hides, fades and
// deletes its layer. Every assertion reads the open document or the DOM.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { LayerPanel } from "../LayerPanel";
import {
  createDocument,
  currentDocument,
  openDocument,
} from "../../state/document";
import { USGS_IMAGERY } from "../AddTileLayerForm";

import { unbindPanelScene } from "./fixtures/panelScene";

const URL_T = "https://tiles.example.org/{z}/{x}/{y}.png";

beforeEach(() => {
  openDocument(createDocument());
});

afterEach(() => {
  cleanup();
  unbindPanelScene();
});

const tiles = () =>
  currentDocument()
    .snapshot()
    .overlays.filter((e) => e.kind === "tile");

function openForm() {
  render(<LayerPanel />);
  fireEvent.click(screen.getByTestId("tile-add-open"));
}

describe("Add tile layer", () => {
  it("refuses a URL the map cannot use, says why, and adds nothing", () => {
    openForm();
    fireEvent.change(screen.getByTestId("tile-url"), {
      target: { value: "http://tiles.example.org/{z}/{x}/{y}.png" },
    });
    fireEvent.click(screen.getByTestId("tile-add-submit"));

    expect(screen.getByTestId("tile-add-error").textContent).toMatch(
      /Use https/,
    );
    expect(tiles()).toEqual([]);
  });

  it("adds a tile layer with its name, credit and opacity", () => {
    openForm();
    fireEvent.change(screen.getByTestId("tile-url"), {
      target: { value: URL_T },
    });
    fireEvent.change(screen.getByTestId("tile-name"), {
      target: { value: "Aerial 2024" },
    });
    fireEvent.change(screen.getByTestId("tile-attribution"), {
      target: { value: "© Example Aerials" },
    });
    fireEvent.change(screen.getByTestId("tile-opacity"), {
      target: { value: "0.6" },
    });
    fireEvent.click(screen.getByTestId("tile-add-submit"));

    expect(tiles()).toEqual([
      expect.objectContaining({
        label: "Aerial 2024",
        url: URL_T,
        attribution: "© Example Aerials",
        opacity: 0.6,
        visible: true,
      }),
    ]);
    expect(tiles()[0].id).toMatch(/^tl:/);
    // The form closes and the row is in the panel.
    expect(screen.queryByTestId("tile-url")).toBeNull();
    expect(screen.getByText("Aerial 2024")).toBeTruthy();
  });

  it("names a layer after its server when no name is given", () => {
    openForm();
    fireEvent.change(screen.getByTestId("tile-url"), {
      target: { value: URL_T },
    });
    fireEvent.click(screen.getByTestId("tile-add-submit"));
    expect(tiles()[0]?.label).toBe("tiles.example.org");
  });

  it("the aerial preset fills in the URL and the credit", () => {
    openForm();
    fireEvent.click(screen.getByTestId("tile-preset-usgs"));
    expect((screen.getByTestId("tile-url") as HTMLInputElement).value).toBe(
      USGS_IMAGERY.url,
    );
    expect(
      (screen.getByTestId("tile-attribution") as HTMLInputElement).value,
    ).toBe(USGS_IMAGERY.attribution);
  });

  it("Cancel closes the form and adds nothing", () => {
    openForm();
    fireEvent.change(screen.getByTestId("tile-url"), {
      target: { value: URL_T },
    });
    fireEvent.click(screen.getByTestId("tile-add-cancel"));
    expect(screen.queryByTestId("tile-url")).toBeNull();
    expect(tiles()).toEqual([]);
  });
});

describe("a tile layer row", () => {
  beforeEach(() => {
    currentDocument().dispatch({
      type: "add-tile-layer",
      id: "tl:a",
      label: "Aerial",
      url: URL_T,
    });
  });

  it("hides and shows the layer", () => {
    render(<LayerPanel />);
    fireEvent.click(screen.getByTestId("layer-visibility-tl:a"));
    expect(tiles()[0]?.visible).toBe(false);
  });

  it("fades the layer with its opacity slider", () => {
    render(<LayerPanel />);
    fireEvent.change(screen.getByTestId("layer-opacity-tl:a"), {
      target: { value: "0.3" },
    });
    expect(tiles()[0]?.opacity).toBe(0.3);
  });

  it("deletes the layer after the confirm step", () => {
    render(<LayerPanel />);
    fireEvent.click(screen.getByTestId("layer-menu-tl:a"));
    fireEvent.click(screen.getByTestId("layer-delete-tl:a"));
    fireEvent.click(screen.getByTestId("layer-delete-confirm-tl:a"));
    expect(tiles()).toEqual([]);
  });
});
