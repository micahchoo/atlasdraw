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
  type PinHit,
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

function setup(
  properties: Record<string, unknown>,
  enabled = true,
  pinAt?: (lngLat: { lng: number; lat: number }) => PinHit | null,
) {
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
    usePopupOnClick(map as unknown as PopupMap, enabled, popup, pinAt);
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

describe("a pin's details", () => {
  const PHOTO = "data:image/png;base64,iVBORw0KGgo=";
  const pin: PinHit = {
    kind: "pin",
    id: "pin-1",
    details: {
      title: "<b>Well</b>",
      description: "Dug 1902.\n<script>alert(1)</script>",
      link: "https://example.org/well",
    },
    photoUrl: PHOTO,
  };
  /** The pin is at (40, -30), over the well feature. */
  const at = (p: PinHit) => (ll: { lng: number; lat: number }) =>
    ll.lng === 40 && ll.lat === -30 ? p : null;

  it("a click on a pin shows its details, before a feature under it", () => {
    const { map } = setup({ name: "Well 4" }, true, at(pin));
    map.clickAt(40, -30);

    const popup = popupEl()!;
    expect(popup.textContent).toContain("<b>Well</b>");
    expect(popup.querySelector("b")).toBeNull();
    expect(popup.querySelector("script")).toBeNull();
    expect(popup.textContent).toContain("<script>alert(1)</script>");
    expect(popup.querySelector("tbody")).toBeNull();
  });

  it("opens its link in a new tab with no opener and no referrer", () => {
    const { map } = setup({}, true, at(pin));
    map.clickAt(40, -30);

    const a = popupEl()!.querySelector("a")!;
    expect(a.getAttribute("href")).toBe("https://example.org/well");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("shows no link that is not http or https, and no remote photo", () => {
    const bad: PinHit = {
      ...pin,
      // eslint-disable-next-line no-script-url
      details: { title: "Well", link: "javascript:alert(1)" },
      photoUrl: "https://tracker.example.org/x.png",
    };
    const { map } = setup({}, true, at(bad));
    map.clickAt(40, -30);

    expect(popupEl()!.querySelector("a")).toBeNull();
    expect(popupEl()!.querySelector("img")).toBeNull();
  });

  it("shows the photo from the drawing's own file", () => {
    const { map } = setup({}, true, at(pin));
    map.clickAt(40, -30);

    const img = popupEl()!.querySelector("img")!;
    expect(img.getAttribute("src")).toBe(PHOTO);
    expect(img.getAttribute("alt")).toBe("<b>Well</b>");
  });

  it("names an untitled pin, and a locked embed opens nothing", () => {
    const untitled: PinHit = { ...pin, details: {}, photoUrl: null };
    const { map } = setup({}, true, at(untitled));
    map.clickAt(40, -30);
    expect(popupEl()!.textContent).toContain("Pin");
    cleanup();

    const locked = setup({}, false, at(pin));
    locked.map.clickAt(40, -30);
    expect(popupEl()).toBeNull();
  });
});
