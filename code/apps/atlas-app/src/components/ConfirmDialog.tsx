// SPDX-License-Identifier: AGPL-3.0-only
//
// ConfirmDialog — a question with two answers, in the page. Used where an
// action would replace or destroy the user's work. window.confirm blocks the
// page and cannot be styled or tested; this can. `tone="destructive"` paints
// the confirm button red, for an action that cannot be undone.
//
// Escape and the Cancel button cancel. Focus starts on Cancel, the answer
// that loses nothing, and stays inside the dialog (FocusTrap).

import React, { useEffect } from "react";

import styles from "../styles/ConfirmDialog.module.css";

import { FocusTrap } from "./FocusTrap";

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
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCancel();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return (
    <div className={styles.scrim} data-testid="confirm-dialog">
      <FocusTrap>
        <div
          className={styles.dialog}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="confirm-dialog-title"
          aria-describedby="confirm-dialog-body"
        >
          <h2 id="confirm-dialog-title" className={styles.title}>
            {title}
          </h2>
          <p id="confirm-dialog-body" className={styles.body}>
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
            <button
              type="button"
              className={styles.button}
              onClick={onCancel}
              data-testid="confirm-dialog-cancel"
              autoFocus
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              className={[
                styles.button,
                tone === "destructive"
                  ? styles.buttonDestructive
                  : styles.buttonPrimary,
              ].join(" ")}
              onClick={onConfirm}
              data-testid="confirm-dialog-confirm"
              data-tone={tone}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </FocusTrap>
    </div>
  );
};
