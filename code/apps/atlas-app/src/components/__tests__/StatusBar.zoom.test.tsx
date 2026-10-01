// SPDX-License-Identifier: AGPL-3.0-only
//
// The status bar's zoom readout is the map's zoom level, written as a level
// ("z 4.0"), not as a magnification ("4.0×").

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { StatusBar } from "../StatusBar";

import type * as maplibregl from "maplibre-gl";

afterEach(cleanup);

function mapAt(zoom: number): maplibregl.Map {
  return {
    getCenter: () => ({ lng: 78.5, lat: 22 }),
    getZoom: () => zoom,
    on: () => undefined,
    off: () => undefined,
  } as unknown as maplibregl.Map;
}

describe("StatusBar zoom", () => {
  it("reads as a zoom level", () => {
    render(<StatusBar map={mapAt(4)} />);
    expect(screen.getByTestId("status-bar-zoom").textContent).toBe("z 4.0");
  });

  it("keeps one decimal", () => {
    render(<StatusBar map={mapAt(12.345)} />);
    expect(screen.getByTestId("status-bar-zoom").textContent).toBe("z 12.3");
  });
});
