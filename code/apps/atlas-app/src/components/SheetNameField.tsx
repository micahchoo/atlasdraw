// SPDX-License-Identifier: AGPL-3.0-only
//
// SheetNameField — the click-to-edit document name in the collar head bar.
//
// CollarShell is layout + frame only (see its file header), so the edit state
// lives here and the shell takes the field as a slot.
//
// Interaction contract:
//   click / Enter / Space on the label  → edit, with the text pre-selected
//   Enter or blur                       → commit
//   Escape                              → cancel, restore the previous name
//   blank input                         → treated as a cancel, not a reset to
//                                         "Untitled atlasdraw" — clearing the
//                                         box is how you retype, not how you
//                                         throw the name away
//
// A committed rename is a `rename-document` command on the open document. It
// raises the document's revision, and that marks the document dirty.

import React, { useCallback, useState } from "react";

import { dispatch, useDocument } from "../state/document";

import styles from "../styles/CollarShell.module.css";

export function SheetNameField() {
  const title = useDocument((s) => s.title);

  // `null` means "not editing" — distinct from "editing an empty string",
  // which is a state the user can legitimately be in mid-edit.
  const [draft, setDraft] = useState<string | null>(null);

  const commit = useCallback(() => {
    if (draft === null) {
      return;
    }
    const next = draft.trim();
    setDraft(null);
    // A blank box is a cancel. A rename to the same name is no command, so
    // blurring the field without typing does not mark the document dirty.
    if (next !== "" && next !== title) {
      dispatch({ type: "rename-document", title: next });
    }
  }, [draft, title]);

  // select() focuses the element too, but the explicit focus() keeps the
  // behaviour independent of that browser detail.
  const focusAndSelect = useCallback((el: HTMLInputElement | null) => {
    el?.focus();
    el?.select();
  }, []);

  if (draft === null) {
    return (
      <button
        type="button"
        className={styles.sheetName}
        data-testid="collar-sheet-name"
        title="Rename this map"
        onClick={() => setDraft(title)}
      >
        {title}
      </button>
    );
  }

  return (
    <input
      type="text"
      ref={focusAndSelect}
      className={styles.sheetNameInput}
      data-testid="collar-sheet-name-input"
      aria-label="Map name"
      // Grow with the text so a long name isn't edited through a peephole.
      // An input can't size to its content in CSS alone; `ch` is close enough
      // on the head bar's own font.
      style={{ width: `${Math.min(Math.max(draft.length + 2, 14), 48)}ch` }}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          // Don't let Escape reach the window-level handler in
          // useMapEditorKeyboard — cancelling the rename is the whole event.
          e.stopPropagation();
          setDraft(null);
        }
      }}
    />
  );
}
