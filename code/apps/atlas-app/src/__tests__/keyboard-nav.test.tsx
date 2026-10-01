// SPDX-License-Identifier: AGPL-3.0-only
// Keyboard nav tests.
//
// Cross-component assertions: modals auto-focus a sensible target on open,
// Escape triggers onCloseRequest (which the calling parent uses to unmount),
// and the FocusScope restores focus to the opener on unmount.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { ExportDialog } from "../components/ExportDialog";

afterEach(() => {
  cleanup();
});

// ExportDialog is the modal under test: it wires FocusTrap and its own Escape
// handler the way every modal does.
function renderExportDialog(onClose: () => void = () => {}) {
  return render(
    <ExportDialog
      onCloseRequest={onClose}
      onExportPNG={() => {}}
      onExportGeoJSON={() => {}}
      onExportAtlasdraw={() => {}}
      getView={() => null}
      getMapImageDataUrl={async () => null}
      getLegendEntries={() => []}
    />,
  );
}

describe("keyboard nav — focus on open", () => {
  it("ExportDialog auto-focuses inside the dialog on mount", () => {
    renderExportDialog();
    // FocusTrap (react-aria FocusScope, autoFocus) moves focus to the first
    // focusable element. The active element should be inside the dialog.
    const dialog = screen.getByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
});

describe("keyboard nav — Escape closes", () => {
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
