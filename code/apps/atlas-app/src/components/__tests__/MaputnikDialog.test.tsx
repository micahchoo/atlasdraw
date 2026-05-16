// SPDX-License-Identifier: AGPL-3.0-only
// Phase 6 A4 — MaputnikDialog tests.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  fireEvent,
} from "@testing-library/react";

import { MaputnikDialog } from "../MaputnikDialog";

afterEach(() => {
  cleanup();
});

const DEFAULT_PROPS = {
  activeStyleUrl: "https://example.org/styles/protomaps-light.json",
  maputnikUrl: "https://maputnik.github.io/editor/",
};

describe("MaputnikDialog", () => {
  it("renders with role=dialog and the documented aria-label", () => {
    render(
      <MaputnikDialog
        {...DEFAULT_PROPS}
        onCloseRequest={() => {}}
      />,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeTruthy();
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-label")).toBe(
      "Maputnik basemap style editor",
    );
  });

  it("passes the active style URL to Maputnik as an encoded query parameter", () => {
    render(
      <MaputnikDialog
        {...DEFAULT_PROPS}
        onCloseRequest={() => {}}
      />,
    );
    const iframe = screen.getByTestId(
      "maputnik-dialog-iframe",
    ) as HTMLIFrameElement;
    expect(iframe.src).toContain("https://maputnik.github.io/editor/");
    expect(iframe.src).toContain(
      encodeURIComponent("https://example.org/styles/protomaps-light.json"),
    );
  });

  it("honours a custom Maputnik base URL (self-hosted)", () => {
    render(
      <MaputnikDialog
        activeStyleUrl="https://example.org/style.json"
        maputnikUrl="https://maputnik.example.org/editor/"
        onCloseRequest={() => {}}
      />,
    );
    const iframe = screen.getByTestId(
      "maputnik-dialog-iframe",
    ) as HTMLIFrameElement;
    expect(iframe.src).toContain("maputnik.example.org/editor/");
  });

  it("applies a restrictive sandbox (no top-navigation) on the iframe", () => {
    render(
      <MaputnikDialog
        {...DEFAULT_PROPS}
        onCloseRequest={() => {}}
      />,
    );
    const iframe = screen.getByTestId(
      "maputnik-dialog-iframe",
    ) as HTMLIFrameElement;
    const sandbox = iframe.getAttribute("sandbox") ?? "";
    expect(sandbox).toContain("allow-scripts");
    expect(sandbox).toContain("allow-same-origin");
    expect(sandbox).toContain("allow-forms");
    // Security posture: do NOT allow top-navigation or escape-sandbox popups.
    expect(sandbox).not.toContain("allow-top-navigation");
    expect(sandbox).not.toContain("allow-popups-to-escape-sandbox");
  });

  it("Escape key triggers onCloseRequest", () => {
    const onClose = vi.fn();
    render(
      <MaputnikDialog {...DEFAULT_PROPS} onCloseRequest={onClose} />,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("X button triggers onCloseRequest", () => {
    const onClose = vi.fn();
    render(
      <MaputnikDialog {...DEFAULT_PROPS} onCloseRequest={onClose} />,
    );
    fireEvent.click(screen.getByTestId("maputnik-dialog-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clicking outside the panel triggers onCloseRequest", async () => {
    const onClose = vi.fn();
    render(
      <MaputnikDialog {...DEFAULT_PROPS} onCloseRequest={onClose} />,
    );
    const overlay = screen.getByTestId("maputnik-dialog-overlay");
    // Wait one tick — click listener is attached via setTimeout(…, 0) to
    // avoid eating the click that opened the dialog.
    await new Promise((r) => setTimeout(r, 0));
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Reset to defaults remounts the iframe (key changes) without closing the dialog", () => {
    const onClose = vi.fn();
    render(
      <MaputnikDialog {...DEFAULT_PROPS} onCloseRequest={onClose} />,
    );
    const before = screen.getByTestId(
      "maputnik-dialog-iframe",
    ) as HTMLIFrameElement;
    fireEvent.click(screen.getByTestId("maputnik-dialog-reset"));
    const after = screen.getByTestId(
      "maputnik-dialog-iframe",
    ) as HTMLIFrameElement;
    // Same src (resetting to defaults reloads the original style).
    expect(after.src).toBe(before.src);
    // Reset must not close the dialog.
    expect(onClose).not.toHaveBeenCalled();
  });

  it("renders the read-only-from-our-side hint (Maputnik has no postMessage write-back)", () => {
    render(
      <MaputnikDialog {...DEFAULT_PROPS} onCloseRequest={() => {}} />,
    );
    const hint = screen.getByTestId("maputnik-dialog-hint");
    expect(hint.textContent).toMatch(/not saved back/);
  });
});
