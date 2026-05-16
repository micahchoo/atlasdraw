// SPDX-License-Identifier: AGPL-3.0-only
// Phase 6 Wave 1b A5 — ColorRampPicker tests.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { ColorRampPicker } from "../ColorRampPicker";

afterEach(() => {
  cleanup();
});

describe("ColorRampPicker", () => {
  it("renders one button per preset ramp", () => {
    render(<ColorRampPicker value={[]} onChange={() => {}} />);
    // Six ramps defined in the static palette table.
    expect(screen.getByTestId("ramp-Viridis")).toBeTruthy();
    expect(screen.getByTestId("ramp-Magma")).toBeTruthy();
    expect(screen.getByTestId("ramp-Set2")).toBeTruthy();
    expect(screen.getByTestId("ramp-Pastel1")).toBeTruthy();
    expect(screen.getByTestId("ramp-OrRd")).toBeTruthy();
    expect(screen.getByTestId("ramp-YlGnBu")).toBeTruthy();
  });

  it("clicking a ramp swatch fires onChange with its colors (length = stops)", () => {
    const onChange = vi.fn();
    render(<ColorRampPicker value={[]} onChange={onChange} stops={5} />);

    fireEvent.click(screen.getByTestId("ramp-OrRd"));

    expect(onChange).toHaveBeenCalledTimes(1);
    const colors = onChange.mock.calls[0][0];
    expect(Array.isArray(colors)).toBe(true);
    expect(colors).toHaveLength(5);
    // OrRd's first stop is a known yellow.
    expect(colors[0]).toBe("#fef0d9");
  });

  it("respects the stops prop and re-samples to that length", () => {
    const onChange = vi.fn();
    render(<ColorRampPicker value={[]} onChange={onChange} stops={3} />);

    fireEvent.click(screen.getByTestId("ramp-Viridis"));
    expect(onChange.mock.calls[0][0]).toHaveLength(3);
  });
});
