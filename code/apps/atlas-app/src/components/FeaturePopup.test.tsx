// SPDX-License-Identifier: AGPL-3.0-only
//
// The attribute popup: a click on a feature shows its properties at the
// click, Escape and a click elsewhere close it, and it is reachable by
// keyboard. The map is FakeMapLibre with the real reconciler; every
// assertion reads the rendered DOM.

import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createDocument, openDocument } from "../state/document";
import { FakeMapLibre } from "../lib/__tests__/fixtures/fakeMapLibre";
import {
  createMapOverlays,
  overlaySpec,
  type StyleTarget,
} from "../lib/mapOverlays";
import {
  POPUP_ROWS,
  useFeaturePopup,
  usePopupOnClick,
  type PopupMap,
} from "../hooks/useFeaturePopup";

import { FeaturePopup } from "./FeaturePopup";

type Listener = (e: unknown) => void;

/** A fake map that also takes clicks and camera moves. */
class ClickMap extends FakeMapLibre {
  private readonly listeners = new Map<string, Set<Listener>>();
  /** Added to every projected point: a camera move. */
  shift = { x: 0, y: 0 };

  override on(type: string, fn: never): this {
    if (type === "error") {
      return super.on(type, fn);
    }
    const set = this.listeners.get(type) ?? new Set<Listener>();
    set.add(fn);
    this.listeners.set(type, set);
    return this;
  }

  override off(type: string, fn: never): this {
    if (type === "error") {
      return super.off(type, fn);
    }
    this.listeners.get(type)?.delete(fn);
    return this;
  }

  override project(lngLat: [number, number] | { lng: number; lat: number }) {
    const p = super.project(lngLat);
    return { x: p.x + this.shift.x, y: p.y + this.shift.y };
  }

  emit(type: string, event: unknown = {}): void {
    for (const fn of Array.from(this.listeners.get(type) ?? [])) {
      fn(event);
    }
  }

  /** A click at a lng/lat, at the point the fake projection gives it. */
  clickAt(lng: number, lat: number): void {
    act(() => {
      this.emit("click", {
        point: this.project([lng, lat]),
        lngLat: { lng, lat },
      });
    });
  }
}

const WELLS = "dl:wells";

function setup(properties: Record<string, unknown>, enabled = true) {
  const doc = createDocument();
  doc.dispatch({
    type: "add-data-layer",
    id: WELLS,
    fc: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties,
          geometry: { type: "Point", coordinates: [40, -30] },
        },
      ],
    },
    label: "Wells",
    style: { fillColor: "#0aa" },
  });
  openDocument(doc);
  const map = new ClickMap();
  createMapOverlays(map as unknown as StyleTarget).apply(
    overlaySpec(doc.snapshot()),
  );
  map.drawUnderPointer(WELLS, [{ properties }]);

  function Host() {
    const popup = useFeaturePopup(map as unknown as PopupMap);
    usePopupOnClick(map as unknown as PopupMap, enabled, popup);
    return (
      <div>
        <button type="button" data-testid="elsewhere">
          elsewhere
        </button>
        <FeaturePopup popup={popup.popup} onClose={popup.close} />
      </div>
    );
  }
  render(<Host />);
  return { map };
}

const popupEl = () => screen.queryByTestId("feature-popup");

afterEach(() => {
  cleanup();
  openDocument(createDocument());
});

describe("FeaturePopup", () => {
  it("a click on a feature shows its properties as a two-column table", () => {
    const { map } = setup({ name: "Well 4", depth: 12 });
    map.clickAt(40, -30);

    const popup = popupEl();
    expect(popup).not.toBeNull();
    expect(popup!.textContent).toContain("Wells");
    const rows = Array.from(popup!.querySelectorAll("tbody tr")).map((tr) =>
      Array.from(tr.children).map((c) => c.textContent),
    );
    expect(rows).toEqual([
      ["name", "Well 4"],
      ["depth", "12"],
    ]);
  });

  it("is anchored at the click and follows it when the camera moves", () => {
    const { map } = setup({ name: "Well 4" });
    map.clickAt(40, -30);
    expect(popupEl()!.style.left).toBe("40px");
    expect(popupEl()!.style.top).toBe("30px");

    map.shift = { x: 15, y: -5 };
    act(() => map.emit("move"));
    expect(popupEl()!.style.left).toBe("55px");
    expect(popupEl()!.style.top).toBe("25px");
  });

  it("shows keys and values as text, never as HTML", () => {
    const { map } = setup({ "<b>key</b>": "<img src=x onerror=alert(1)>" });
    map.clickAt(40, -30);

    const popup = popupEl()!;
    expect(popup.querySelector("b")).toBeNull();
    expect(popup.querySelector("img")).toBeNull();
    expect(popup.textContent).toContain("<b>key</b>");
    expect(popup.textContent).toContain("<img src=x onerror=alert(1)>");
  });

  it("shows the first rows and a button that shows all of them", () => {
    const many: Record<string, unknown> = {};
    for (let i = 0; i < POPUP_ROWS + 4; i++) {
      many[`field${i}`] = i;
    }
    const { map } = setup(many);
    map.clickAt(40, -30);

    expect(popupEl()!.querySelectorAll("tbody tr")).toHaveLength(POPUP_ROWS);
    fireEvent.click(screen.getByTestId("feature-popup-show-all"));
    expect(popupEl()!.querySelectorAll("tbody tr")).toHaveLength(
      POPUP_ROWS + 4,
    );
    expect(screen.queryByTestId("feature-popup-show-all")).toBeNull();
  });

  it("takes the keyboard focus, and Escape closes it and gives focus back", () => {
    const { map } = setup({ name: "Well 4" });
    const before = screen.getByTestId("elsewhere");
    before.focus();
    map.clickAt(40, -30);

    expect(popupEl()!.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(popupEl()).toBeNull();
    expect(document.activeElement).toBe(before);
  });

  it("the close button closes it", () => {
    const { map } = setup({ name: "Well 4" });
    map.clickAt(40, -30);
    fireEvent.click(screen.getByTestId("feature-popup-close"));
    expect(popupEl()).toBeNull();
  });

  it("a press elsewhere closes it; a press inside does not", () => {
    const { map } = setup({ name: "Well 4" });
    map.clickAt(40, -30);

    fireEvent.pointerDown(popupEl()!.querySelector("td")!);
    expect(popupEl()).not.toBeNull();
    fireEvent.pointerDown(screen.getByTestId("elsewhere"));
    expect(popupEl()).toBeNull();
  });

  it("a click on the empty map closes it", () => {
    const { map } = setup({ name: "Well 4" });
    map.clickAt(40, -30);
    map.drawUnderPointer(WELLS, []);
    map.clickAt(10, -10);
    expect(popupEl()).toBeNull();
  });

  it("opens nothing where clicks are turned off (a locked embed)", () => {
    const { map } = setup({ name: "Well 4" }, false);
    map.clickAt(40, -30);
    expect(popupEl()).toBeNull();
  });
});
