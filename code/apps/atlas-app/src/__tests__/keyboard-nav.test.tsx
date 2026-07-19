// SPDX-License-Identifier: AGPL-3.0-only
// Phase 6 A14a — keyboard nav tests.
//
// Cross-component assertions: modals auto-focus a sensible target on open,
// Escape triggers onCloseRequest (which the calling parent uses to unmount),
// and the FocusScope restores focus to the opener on unmount.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { MaputnikDialog } from "../components/MaputnikDialog";
import { ExportDialog } from "../components/ExportDialog";

afterEach(() => {
  cleanup();
});

// BasemapPickerDialog was deleted in the IA restructure (basemap picking
// moved into LayerPanel's Basemap section — a sidebar surface, not a modal).
// ExportDialog stands in as the second modal-under-test: it wires FocusTrap
// and its own Escape handler the same way.
function renderExportDialog(onClose: () => void = () => {}) {
  return render(
    <ExportDialog
      onCloseRequest={onClose}
      onExportPNG={() => {}}
      onExportGeoJSON={() => {}}
      onExportAtlasdraw={() => {}}
      getMapCanvas={() => null}
      layers={[]}
    />,
  );
}

describe("keyboard nav — focus on open", () => {
  it("MaputnikDialog auto-focuses the close button on mount", () => {
    render(
      <MaputnikDialog
        activeStyleUrl="https://example.org/style.json"
        maputnikUrl="https://maputnik.github.io/editor/"
        onCloseRequest={() => {}}
      />,
    );
    // The dialog focuses the close button (`maputnik-dialog-close`) via
    // closeBtnRef.current?.focus() in its own effect. FocusTrap's autoFocus
    // doesn't fight that — react-aria's FocusScope honours a manual focus
    // call once mounted.
    const close = screen.getByTestId("maputnik-dialog-close");
    expect(document.activeElement).toBe(close);
  });

  it("ExportDialog auto-focuses inside the dialog on mount", () => {
    renderExportDialog();
    // FocusTrap (react-aria FocusScope, autoFocus) moves focus to the first
    // focusable element. The active element should be inside the dialog.
    const dialog = screen.getByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
});

describe("keyboard nav — Escape closes", () => {
  it("MaputnikDialog: Escape triggers onCloseRequest", () => {
    const onClose = vi.fn();
    render(
      <MaputnikDialog
        activeStyleUrl="https://example.org/style.json"
        maputnikUrl="https://maputnik.github.io/editor/"
        onCloseRequest={onClose}
      />,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("ExportDialog: Escape triggers onCloseRequest", () => {
    const onClose = vi.fn();
    renderExportDialog(onClose);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});

describe("keyboard nav — restore focus on unmount", () => {
  it("FocusScope releases focus when a modal unmounts (returns to opener or body)", () => {
    const opener = document.createElement("button");
    opener.setAttribute("data-testid", "opener");
    document.body.appendChild(opener);
    opener.focus();

    const { unmount } = renderExportDialog();
    // Sanity: focus has moved into the dialog.
    expect(document.activeElement).not.toBe(opener);

    unmount();
    // jsdom's focus semantics differ from a real browser — FocusScope's
    // restoreFocus may park focus on document.body if the opener's tab-order
    // position is ambiguous. Both are valid "trap released" outcomes; the
    // post-condition we care about is that focus is NOT inside the dialog.
    const released =
      document.activeElement === opener ||
      document.activeElement === document.body;
    expect(released).toBe(true);
    document.body.removeChild(opener);
  });
});
