/**
 * KeyboardShortcuts — searchable shortcut reference, summoned with `?`.
 *
 * Renders a scrim + centered panel listing the rows it is given (the
 * drawing's keys and every command's, commands.ts#shortcutRows), grouped.
 * Type to filter. Esc or click-outside to dismiss.
 *
 * Design: instrumental reference card — dense, searchable, mono for keys.
 * Feels like the quick-reference card that came with a drafting instrument.
 */

import React, { useState, useMemo, useEffect, useRef } from "react";

import styles from "../styles/KeyboardShortcuts.module.css";

import { SHORTCUT_GROUPS, type ShortcutRow } from "../commands/commands";

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
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

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
    <div
      className={styles.scrim}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      data-testid="keyboard-shortcuts-scrim"
    >
      <div
        className={styles.panel}
        role="dialog"
        aria-label="Keyboard shortcuts"
        data-testid="keyboard-shortcuts-panel"
      >
        {/* Search */}
        <div className={styles.searchRow}>
          <span className={styles.searchIcon}>@</span>
          <input
            ref={inputRef}
            className={styles.searchInput}
            type="text"
            placeholder="Filter shortcuts..."
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
        <div className={styles.footer}>
          <span>Esc to close</span>
          <span>Type to filter</span>
        </div>
      </div>
    </div>
  );
}
