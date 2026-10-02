// SPDX-License-Identifier: AGPL-3.0-only
// Keyboard nav tests.
//
// Cross-component assertions: modals auto-focus a sensible target on open,
// Escape triggers onCloseRequest (which the calling parent uses to unmount),
// and the Modal gives focus back to the opener on unmount. The Modal's own
// rules are in components/__tests__/Modal.test.tsx; focus order in a real
// browser is e2e/keyboard.spec.ts.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { ExportDialog } from "../components/ExportDialog";

afterEach(() => {
  cleanup();
});

// ExportDialog is the modal under test: it is a Modal, as every dialog is.
function renderExportDialog(onClose: () => void = () => {}) {
  return render(
    <ExportDialog
      onCloseRequest={onClose}
      onExportPNG={() => {}}
      onExportGeoJSON={() => {}}
      onExportAtlasdraw={() => {}}
      captureView={() => null}
      renderImage={async () => ""}
      getLegendEntries={() => []}
    />,
  );
}

describe("keyboard nav — focus on open", () => {
  it("ExportDialog auto-focuses inside the dialog on mount", () => {
    renderExportDialog();
    // Modal (react-aria FocusScope, autoFocus) moves focus to the first
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
  it("gives focus back to the opener when the modal unmounts", () => {
    const opener = document.createElement("button");
    opener.setAttribute("data-testid", "opener");
    document.body.appendChild(opener);
    opener.focus();

    const { unmount } = renderExportDialog();
    // Sanity: focus has moved into the dialog.
    expect(document.activeElement).not.toBe(opener);

    unmount();
    expect(document.activeElement).toBe(opener);
    document.body.removeChild(opener);
  });
});
