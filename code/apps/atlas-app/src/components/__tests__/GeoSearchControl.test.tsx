// SPDX-License-Identifier: AGPL-3.0-only
// UI tests for GeoSearchControl — the toolbar geo-search button + popover.
//
// The geocoding/camera logic is covered in hooks/useGeocoderSearch.test.ts;
// here we mock the hook and assert the component's rendering + interaction:
// gating, open/close, result selection -> flyTo, keyboard dismiss, error copy.
//
// Per .claude/rules/test-fixtures.md: this file owns its own mocks.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

import { GeoSearchControl } from "../GeoSearchControl";

import type { PlaceHit } from "../../services/placeSearch";

// Controllable hook return, hoisted so the mock factory can close over it.
const h = vi.hoisted(() => ({
  flyTo: vi.fn(),
  setQuery: vi.fn(),
  reset: vi.fn(),
  ret: {
    enabled: true,
    query: "",
    results: [] as readonly PlaceHit[],
    status: "idle" as "idle" | "loading" | "success" | "empty" | "error",
    errorMessage: null as string | null,
  },
}));

vi.mock("../../hooks/useGeocoderSearch", () => ({
  useGeocoderSearch: () => ({
    ...h.ret,
    flyTo: h.flyTo,
    setQuery: h.setQuery,
    reset: h.reset,
  }),
}));

const PORTLAND: PlaceHit = {
  lng: -122.68,
  lat: 45.52,
  label: "Portland",
  kind: "locality",
  zoom: 11,
};

beforeEach(() => {
  h.flyTo.mockReset();
  h.setQuery.mockReset();
  h.reset.mockReset();
  h.ret = {
    enabled: true,
    query: "",
    results: [],
    status: "idle",
    errorMessage: null,
  };
});

afterEach(() => cleanup());

describe("GeoSearchControl — gating", () => {
  it("renders nothing when the geocoder is disabled", () => {
    h.ret.enabled = false;
    render(<GeoSearchControl map={null} />);
    expect(screen.queryByTestId("geo-search-button")).toBeNull();
  });

  it("renders the toolbar button when enabled (popover closed initially)", () => {
    render(<GeoSearchControl map={null} />);
    expect(screen.getByTestId("geo-search-button")).toBeTruthy();
    expect(screen.queryByTestId("geo-search-popover")).toBeNull();
  });
});

describe("GeoSearchControl — open/close", () => {
  it("toggles the popover open on button click and focuses the input", () => {
    render(<GeoSearchControl map={null} />);
    const button = screen.getByTestId("geo-search-button");
    expect(button.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(button);

    expect(screen.getByTestId("geo-search-popover")).toBeTruthy();
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("geo-search-input")).toBe(document.activeElement);
  });

  it("dismisses on Escape and calls reset", () => {
    render(<GeoSearchControl map={null} />);
    fireEvent.click(screen.getByTestId("geo-search-button"));
    fireEvent.keyDown(screen.getByTestId("geo-search-input"), {
      key: "Escape",
    });
    expect(screen.queryByTestId("geo-search-popover")).toBeNull();
    expect(h.reset).toHaveBeenCalled();
  });
});

describe("GeoSearchControl — typing + results", () => {
  it("forwards input changes to the hook's setQuery", () => {
    render(<GeoSearchControl map={null} />);
    fireEvent.click(screen.getByTestId("geo-search-button"));
    fireEvent.change(screen.getByTestId("geo-search-input"), {
      target: { value: "portland" },
    });
    expect(h.setQuery).toHaveBeenCalledWith("portland");
  });

  it("renders candidate results and flies to the one clicked, then closes", () => {
    h.ret.status = "success";
    h.ret.results = [PORTLAND];
    render(<GeoSearchControl map={null} />);
    fireEvent.click(screen.getByTestId("geo-search-button"));

    const results = screen.getAllByTestId("geo-search-result");
    expect(results).toHaveLength(1);
    expect(results[0].textContent).toContain("Portland");

    fireEvent.click(results[0]);

    expect(h.flyTo).toHaveBeenCalledWith(PORTLAND);
    expect(screen.queryByTestId("geo-search-popover")).toBeNull();
  });

  it("shows the empty-state hint when a search returns nothing", () => {
    h.ret.status = "empty";
    h.ret.query = "zzzzz";
    render(<GeoSearchControl map={null} />);
    fireEvent.click(screen.getByTestId("geo-search-button"));
    expect(screen.getByTestId("geo-search-empty")).toBeTruthy();
  });

  it("surfaces the error message on a failed search", () => {
    h.ret.status = "error";
    h.ret.errorMessage = "Couldn't reach the geocoder — check your connection.";
    render(<GeoSearchControl map={null} />);
    fireEvent.click(screen.getByTestId("geo-search-button"));
    const err = screen.getByTestId("geo-search-error");
    expect(err.textContent).toMatch(/couldn't reach/i);
    expect(err.getAttribute("role")).toBe("alert");
  });
});
