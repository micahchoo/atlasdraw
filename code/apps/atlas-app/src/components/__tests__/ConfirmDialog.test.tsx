// SPDX-License-Identifier: AGPL-3.0-only
//
// The in-page confirm: a question with two answers, never window.confirm.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { ConfirmDialog } from "../ConfirmDialog";

afterEach(cleanup);

function renderDialog() {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <ConfirmDialog
      title="Open another map?"
      body="This map has changes you have not saved to a file."
      confirmLabel="Open anyway"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />,
  );
  return { onConfirm, onCancel };
}

describe("ConfirmDialog", () => {
  it("asks the question as an alert dialog", () => {
    renderDialog();
    const dialog = screen.getByRole("alertdialog", {
      name: "Open another map?",
    });
    expect(dialog.textContent).toContain("not saved to a file");
  });

  it("confirms with the confirm button", () => {
    const { onConfirm, onCancel } = renderDialog();
    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("cancels with the cancel button and with Escape", () => {
    const { onConfirm, onCancel } = renderDialog();
    fireEvent.click(screen.getByTestId("confirm-dialog-cancel"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
