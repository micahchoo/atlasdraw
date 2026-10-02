// SPDX-License-Identifier: AGPL-3.0-only
//
// ConfirmDialog — a question with two answers, in the page. Used where an
// action would replace or destroy the user's work. window.confirm blocks the
// page and cannot be styled or tested; this can. `tone="destructive"` paints
// the confirm button red, for an action that cannot be undone.
//
// Escape, a press outside and the Cancel button cancel. Focus starts on
// Cancel, the answer that loses nothing, and stays inside the dialog
// (Modal). Escape reaches only the newest dialog, so a question asked
// inside another dialog cancels itself and leaves that dialog open.

import React, { useId } from "react";

import styles from "../styles/ConfirmDialog.module.css";

import { Button } from "./Button";
import { Modal } from "./Modal";

export interface ConfirmDialogProps {
  title: string;
  body: string;
  confirmLabel: string;
  /** The cancel button's text; "Cancel" when unset. */
  cancelLabel?: string;
  /** "destructive": the confirm button is red. */
  tone?: "default" | "destructive";
  /** A checkbox that goes with the answer, below the body. */
  option?: {
    label: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
  };
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  title,
  body,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "default",
  option,
  onConfirm,
  onCancel,
}) => {
  const id = useId();
  return (
    <Modal
      role="alertdialog"
      labelledBy={`${id}-title`}
      describedBy={`${id}-body`}
      onClose={onCancel}
      scrimClassName={styles.scrim}
      scrimTestId="confirm-dialog"
      className={styles.dialog}
    >
      <h2 id={`${id}-title`} className={styles.title}>
        {title}
      </h2>
      <p id={`${id}-body`} className={styles.body}>
        {body}
      </p>
      {option && (
        <label className={styles.option}>
          <input
            type="checkbox"
            checked={option.checked}
            onChange={(e) => option.onChange(e.target.checked)}
            data-testid="confirm-dialog-option"
          />
          <span>{option.label}</span>
        </label>
      )}
      <div className={styles.actions}>
        <Button
          onClick={onCancel}
          data-testid="confirm-dialog-cancel"
          autoFocus
        >
          {cancelLabel}
        </Button>
        <Button
          variant={tone === "destructive" ? "destructive" : "primary"}
          onClick={onConfirm}
          data-testid="confirm-dialog-confirm"
          data-tone={tone}
        >
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
};
