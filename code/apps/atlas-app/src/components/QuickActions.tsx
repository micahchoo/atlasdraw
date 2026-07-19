/**
 * QuickActions — Cmd+K command palette. Search and execute any action.
 *
 * Summoned with Cmd+K / Ctrl+K. Type to filter across all registered actions.
 * Arrow keys + Enter to navigate and select. Esc to dismiss.
 *
 * Design: drafting-room instrument palette — fast, keyboard-driven, precise.
 * Mono prompt character, blueprint accent on the `>` cursor.
 */

import React, { useState, useMemo, useEffect, useRef } from "react";

import styles from "../styles/QuickActions.module.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QuickAction {
  id: string;
  label: string;
  category: string;
  /** Optional keyboard shortcut hint shown right-aligned. */
  hint?: string;
  /** Search keywords beyond the label. */
  keywords?: string[];
  onSelect: () => void;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface QuickActionsProps {
  actions: QuickAction[];
  onClose: () => void;
}

// ---------------------------------------------------------------------------

const CATEGORY_ORDER = ["Tools", "File", "View", "Export", "Help"];

function groupByCategory(actions: QuickAction[]): Map<string, QuickAction[]> {
  const map = new Map<string, QuickAction[]>();
  for (const a of actions) {
    const list = map.get(a.category) ?? [];
    list.push(a);
    map.set(a.category, list);
  }
  return map;
}

// ---------------------------------------------------------------------------

export function QuickActions({ actions, onClose }: QuickActionsProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = useMemo(() => {
    if (query.trim() === "") {
      return actions;
    }
    const q = query.toLowerCase();
    return actions.filter(
      (a) =>
        a.label.toLowerCase().includes(q) ||
        a.category.toLowerCase().includes(q) ||
        (a.keywords?.some((k) => k.toLowerCase().includes(q)) ?? false),
    );
  }, [actions, query]);

  // Reset selection when filter changes.
  useEffect(() => {
    setSelectedIndex(0);
  }, [filtered]);

  const grouped = useMemo(() => groupByCategory(filtered), [filtered]);

  const flattened = useMemo(() => {
    const result: QuickAction[] = [];
    for (const cat of CATEGORY_ORDER) {
      const items = grouped.get(cat);
      if (items) {
        result.push(...items);
      }
    }
    // Any categories not in the order.
    for (const [cat, items] of grouped) {
      if (!CATEGORY_ORDER.includes(cat)) {
        result.push(...items);
      }
    }
    return result;
  }, [grouped]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, flattened.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
        break;
      case "Enter":
        e.preventDefault();
        if (flattened[selectedIndex]) {
          flattened[selectedIndex].onSelect();
          onClose();
        }
        break;
      case "Escape":
        e.preventDefault();
        onClose();
        break;
    }
  };

  // Scroll selected item into view.
  useEffect(() => {
    const el = listRef.current?.querySelector(
      `[data-action-index="${selectedIndex}"]`,
    );
    // Optional call — jsdom doesn't implement scrollIntoView.
    el?.scrollIntoView?.({ block: "nearest" });
  }, [selectedIndex]);

  return (
    <div
      className={styles.scrim}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      data-testid="quick-actions-scrim"
    >
      <div
        className={styles.panel}
        role="dialog"
        aria-label="Quick actions"
        data-testid="quick-actions-panel"
      >
        <div className={styles.searchRow}>
          <span className={styles.prompt}>&gt;</span>
          <input
            ref={inputRef}
            className={styles.searchInput}
            type="text"
            placeholder="Search actions..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            data-testid="quick-actions-search"
          />
        </div>

        <div className={styles.list} ref={listRef}>
          {flattened.length === 0 ? (
            <div className={styles.empty}>No actions match "{query}"</div>
          ) : (
            CATEGORY_ORDER.filter((c) => grouped.has(c)).map((category) => (
              <div key={category} className={styles.category}>
                <div className={styles.categoryTitle}>{category}</div>
                {grouped.get(category)!.map((a) => {
                  const idx = flattened.indexOf(a);
                  return (
                    <div
                      key={a.id}
                      className={[
                        styles.item,
                        idx === selectedIndex ? styles.itemSelected : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      data-action-index={idx}
                      data-testid={`quick-action-${a.id}`}
                      onClick={() => {
                        a.onSelect();
                        onClose();
                      }}
                      onMouseEnter={() => setSelectedIndex(idx)}
                    >
                      <span className={styles.itemLabel}>{a.label}</span>
                      {a.hint && (
                        <span className={styles.itemHint}>{a.hint}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className={styles.footer}>
          <span>↑↓ Navigate</span>
          <span>Enter to select · Esc to close</span>
        </div>
      </div>
    </div>
  );
}
