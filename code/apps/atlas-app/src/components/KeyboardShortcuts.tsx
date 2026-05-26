/**
 * KeyboardShortcuts — searchable shortcut reference, summoned with `?`.
 *
 * Renders a scrim + centered panel listing all keyboard shortcuts, grouped
 * by category. Type to filter. Esc or click-outside to dismiss.
 *
 * Design: instrumental reference card — dense, searchable, mono for keys.
 * Feels like the quick-reference card that came with a drafting instrument.
 */

import React, { useState, useMemo, useEffect, useRef } from "react";

import styles from "../styles/KeyboardShortcuts.module.css";

// ---------------------------------------------------------------------------
// Shortcut registry
// ---------------------------------------------------------------------------

interface Shortcut {
  keys: string[];
  label: string;
  category: string;
}

const SHORTCUTS: Shortcut[] = [
  // --- Map ---
  {
    keys: ["Pan"],
    label: "Drag to pan map",
    category: "Map",
  },
  {
    keys: ["Scroll"],
    label: "Zoom in / out",
    category: "Map",
  },
  {
    keys: ["Shift", "Drag"],
    label: "Box zoom",
    category: "Map",
  },

  // --- Drawing ---
  {
    keys: ["1"],
    label: "Selection tool (default)",
    category: "Drawing",
  },
  {
    keys: ["2"],
    label: "Rectangle",
    category: "Drawing",
  },
  {
    keys: ["3"],
    label: "Freehand",
    category: "Drawing",
  },
  {
    keys: ["4"],
    label: "Arrow",
    category: "Drawing",
  },
  {
    keys: ["5"],
    label: "Line",
    category: "Drawing",
  },
  {
    keys: ["6"],
    label: "Text",
    category: "Drawing",
  },
  {
    keys: ["H"],
    label: "Hand / pan tool",
    category: "Drawing",
  },

  // --- Editing ---
  {
    keys: ["Delete", "Backspace"],
    label: "Delete selected element",
    category: "Editing",
  },
  {
    keys: ["Ctrl", "Z"],
    label: "Undo",
    category: "Editing",
  },
  {
    keys: ["Ctrl", "Shift", "Z"],
    label: "Redo",
    category: "Editing",
  },
  {
    keys: ["Ctrl", "C"],
    label: "Copy",
    category: "Editing",
  },
  {
    keys: ["Ctrl", "V"],
    label: "Paste",
    category: "Editing",
  },
  {
    keys: ["Ctrl", "D"],
    label: "Duplicate selection",
    category: "Editing",
  },

  // --- Atlas ---
  {
    keys: ["Escape"],
    label: "Cancel active atlas tool",
    category: "Atlas",
  },
  {
    keys: ["?"],
    label: "Show keyboard shortcuts",
    category: "Atlas",
  },

  // --- View ---
  {
    keys: ["Ctrl", "0"],
    label: "Reset zoom / fit to content",
    category: "View",
  },
  {
    keys: ["Ctrl", "+"],
    label: "Zoom in",
    category: "View",
  },
  {
    keys: ["Ctrl", "-"],
    label: "Zoom out",
    category: "View",
  },
];

// ---------------------------------------------------------------------------
// Group shortcuts by category in order
// ---------------------------------------------------------------------------

const CATEGORY_ORDER = ["Map", "Drawing", "Editing", "Atlas", "View"];

function groupByCategory(shortcuts: Shortcut[]): Map<string, Shortcut[]> {
  const map = new Map<string, Shortcut[]>();
  for (const s of shortcuts) {
    const list = map.get(s.category) ?? [];
    list.push(s);
    map.set(s.category, list);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function KeyboardShortcuts({ onClose }: { onClose: () => void }) {
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

  const grouped = useMemo(() => groupByCategory(SHORTCUTS), []);

  const filtered = useMemo(() => {
    if (query.trim() === "") {
      return grouped;
    }
    const q = query.toLowerCase();
    const result = new Map<string, Shortcut[]>();
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
            CATEGORY_ORDER.filter((c) => filtered.has(c)).map((category) => (
              <div key={category} className={styles.category}>
                <div className={styles.categoryTitle}>{category}</div>
                {filtered.get(category)!.map((s, i) => (
                  <div key={i} className={styles.row}>
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
