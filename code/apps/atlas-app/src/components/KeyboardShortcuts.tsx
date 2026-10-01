/**
 * KeyboardShortcuts — searchable shortcut reference, summoned with `?`.
 *
 * Renders a scrim + centered panel listing the rows it is given (the
 * drawing's keys and every command's, commands.ts#shortcutRows), grouped.
 * Type to filter. Escape or a press outside closes it (Modal).
 *
 * Design: instrumental reference card — dense, searchable, mono for keys.
 * Feels like the quick-reference card that came with a drafting instrument.
 */

import React, { useMemo, useState } from "react";

import styles from "../styles/KeyboardShortcuts.module.css";

import { SHORTCUT_GROUPS, type ShortcutRow } from "../commands/commands";

import { Modal } from "./Modal";

/** The panel's own key, which closes it. */
const SHORTCUTS_COMMANDS = ["help.shortcuts"] as const;

function groupRows(rows: readonly ShortcutRow[]): Map<string, ShortcutRow[]> {
  const map = new Map<string, ShortcutRow[]>();
  for (const r of rows) {
    const list = map.get(r.group) ?? [];
    list.push(r);
    map.set(r.group, list);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function KeyboardShortcuts({
  rows,
  onClose,
}: {
  rows: readonly ShortcutRow[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");

  const grouped = useMemo(() => groupRows(rows), [rows]);

  const filtered = useMemo(() => {
    if (query.trim() === "") {
      return grouped;
    }
    const q = query.toLowerCase();
    const result = new Map<string, ShortcutRow[]>();
    for (const [category, items] of grouped) {
      const matches = items.filter(
        (s) =>
          s.label.toLowerCase().includes(q) ||
          s.keys.some((k) => k.toLowerCase().includes(q)) ||
          category.toLowerCase().includes(q),
      );
      if (matches.length > 0) {
        result.set(category, matches);
      }
    }
    return result;
  }, [grouped, query]);

  return (
    <Modal
      label="Keyboard shortcuts"
      onClose={onClose}
      // `?` closes the panel it opened (outside the filter field).
      commands={SHORTCUTS_COMMANDS}
      scrimClassName={styles.scrim}
      scrimTestId="keyboard-shortcuts-scrim"
      className={styles.panel}
      testId="keyboard-shortcuts-panel"
    >
      {/* Search */}
      <div className={styles.searchRow}>
        <span className={styles.searchIcon} aria-hidden="true">
          @
        </span>
        <input
          className={styles.searchInput}
          type="text"
          aria-label="Filter shortcuts"
          placeholder="Filter shortcuts..."
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          data-testid="shortcut-search"
        />
      </div>

      {/* List */}
      <div className={styles.list}>
        {filtered.size === 0 ? (
          <div className={styles.empty}>No shortcuts match "{query}"</div>
        ) : (
          SHORTCUT_GROUPS.filter((c) => filtered.has(c)).map((category) => (
            <div key={category} className={styles.category}>
              <div className={styles.categoryTitle}>{category}</div>
              {filtered.get(category)!.map((s, i) => (
                <div
                  key={i}
                  className={styles.row}
                  data-testid={`shortcut-row-${s.label}`}
                >
                  <span className={styles.label}>{s.label}</span>
                  <span className={styles.kbd}>
                    {s.keys.map((k, j) => (
                      <React.Fragment key={j}>
                        {j > 0 && <span className={styles.plus}>+</span>}
                        <span className={styles.key}>{k}</span>
                      </React.Fragment>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      <div className={styles.footer} aria-hidden="true">
        <span>Esc to close</span>
        <span>Type to filter</span>
      </div>
    </Modal>
  );
}
