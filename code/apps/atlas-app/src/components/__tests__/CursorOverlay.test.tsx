// SPDX-License-Identifier: AGPL-3.0-only
//
// A peer's cursor is a place on Earth; the overlay draws it where this
// viewer's map projects that place, and again after the map moves.

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CursorOverlay } from "../CursorOverlay";

import type { Peer } from "../../state/room";

function fakeMap() {
  let offset = 0;
  const listeners = new Set<() => void>();
  return {
    project: ([lng, lat]: [number, number]) => ({
      x: lng * 10 + offset,
      y: lat * 10,
    }),
    on: (_: string, l: () => void) => listeners.add(l),
    off: (_: string, l: () => void) => listeners.delete(l),
    pan(dx: number) {
      offset += dx;
      listeners.forEach((l) => l());
    },
  };
}

const PEER: Peer = {
  clientId: 7,
  user: { id: "u", name: "Ada", color: "#e03131" },
  cursor: { lng: 13, lat: 52 },
  camera: null,
};

afterEach(cleanup);

describe("CursorOverlay", () => {
  it("draws a peer's cursor at the map's projection of its lng/lat, and follows the map", () => {
    const map = fakeMap();
    render(<CursorOverlay map={map as never} peers={[PEER]} />);

    const cursor = screen.getByTestId("cursor-7");
    expect(cursor.getAttribute("transform")).toBe("translate(130 520)");
    expect(cursor.textContent).toBe("Ada");

    act(() => map.pan(5));
    expect(screen.getByTestId("cursor-7").getAttribute("transform")).toBe(
      "translate(135 520)",
    );
  });

  it("draws nothing for a peer whose pointer is off the map", () => {
    render(
      <CursorOverlay
        map={fakeMap() as never}
        peers={[{ ...PEER, cursor: null }]}
      />,
    );
    expect(screen.queryByTestId("cursor-7")).toBeNull();
  });
});
