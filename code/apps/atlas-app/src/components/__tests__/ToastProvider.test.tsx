// SPDX-License-Identifier: AGPL-3.0-only
//
// The toasts as a screen reader meets them: two live regions that exist
// before the first toast (a region added with its text is often not read),
// errors in the assertive one, and a toast that stays while the pointer or
// the focus is on it.

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider, useToast } from "../ToastProvider";

let toast: ReturnType<typeof useToast>;
function Grab() {
  toast = useToast();
  return null;
}

function renderToasts() {
  return render(
    <ToastProvider>
      <Grab />
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("the live regions", () => {
  it("are in the page before the first toast", () => {
    renderToasts();
    expect(screen.getByTestId("toast-status").getAttribute("role")).toBe(
      "status",
    );
    expect(screen.getByTestId("toast-status").getAttribute("aria-live")).toBe(
      "polite",
    );
    expect(screen.getByTestId("toast-alert").getAttribute("role")).toBe(
      "alert",
    );
    expect(screen.getByTestId("toast-status").textContent).toBe("");
  });

  it("an error goes to the alert region; the rest to the polite one", () => {
    renderToasts();
    act(() => {
      toast.error("Couldn't save the map");
      toast.success("Map saved as .atlasdraw");
    });
    expect(screen.getByTestId("toast-alert").textContent).toContain(
      "Couldn't save the map",
    );
    expect(screen.getByTestId("toast-alert").textContent).not.toContain(
      "Map saved",
    );
    expect(screen.getByTestId("toast-status").textContent).toContain(
      "Map saved as .atlasdraw",
    );
  });
});

describe("how long a toast stays", () => {
  const shown = () => screen.queryAllByTestId("toast-success").length;

  it("goes after 4 seconds", () => {
    renderToasts();
    act(() => void toast.success("Saved"));
    act(() => void vi.advanceTimersByTime(4200));
    expect(shown()).toBe(0);
  });

  it("stays while the pointer is on it, and goes once the pointer leaves", () => {
    renderToasts();
    act(() => void toast.success("Saved"));
    act(() => void vi.advanceTimersByTime(3000));
    fireEvent.mouseEnter(screen.getByTestId("toast-container"));
    act(() => void vi.advanceTimersByTime(10_000));
    expect(shown()).toBe(1);

    fireEvent.mouseLeave(screen.getByTestId("toast-container"));
    act(() => void vi.advanceTimersByTime(500));
    expect(shown()).toBe(1);
    act(() => void vi.advanceTimersByTime(1000));
    expect(shown()).toBe(0);
  });

  it("stays while focus is on it (its Dismiss button)", () => {
    renderToasts();
    act(() => void toast.success("Saved"));
    fireEvent.focus(screen.getByRole("button", { name: "Dismiss" }));
    act(() => void vi.advanceTimersByTime(10_000));
    expect(shown()).toBe(1);
    fireEvent.blur(screen.getByRole("button", { name: "Dismiss" }));
    act(() => void vi.advanceTimersByTime(4200));
    expect(shown()).toBe(0);
  });
});
