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
// A committed rename calls markDirty() — the title is part of the manifest
// (selectDocument reads this store), so without it the rename would sit in
// memory until some *other* edit happened to kick the auto-save debounce.

import React, { useCallback, useState } from "react";

import { useDocumentTitleStore } from "../state/documentTitle";
import { usePersistenceStore } from "../state/usePersistenceStore";

import styles from "../styles/CollarShell.module.css";

export function SheetNameField() {
  const title = useDocumentTitleStore((s) => s.title);
  const setTitle = useDocumentTitleStore((s) => s.setTitle);
  const markDirty = usePersistenceStore((s) => s.markDirty);

  // `null` means "not editing" — distinct from "editing an empty string",
  // which is a state the user can legitimately be in mid-edit.
  const [draft, setDraft] = useState<string | null>(null);

  const commit = useCallback(() => {
    if (draft === null) {
      return;
    }
    const next = draft.trim();
    setDraft(null);
    // A no-op rename must not mark the document dirty — blurring the field
    // without typing is the common case.
    if (next !== "" && next !== title) {
      setTitle(next);
      markDirty();
    }
  }, [draft, title, setTitle, markDirty]);

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
