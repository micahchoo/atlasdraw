/**
 * QuickActions — the command palette (⌘K or Ctrl+K). Type to filter the
 * commands; the arrow keys move the active one; Enter runs it; Escape closes.
 *
 * Screen readers read it as a combobox that controls a listbox: the input
 * keeps focus, and `aria-activedescendant` names the active option, which
 * is `aria-selected`. The active option is marked by a bar as well as by
 * colour. The dialog itself is a Modal, so Tab stays in it and Escape
 * closes it from anywhere in it.
 *
 * Design: drafting-room instrument palette — fast, keyboard-driven, precise.
 * Mono prompt character, blueprint accent on the `>` cursor.
 */

import React, { useEffect, useId, useMemo, useRef, useState } from "react";

import styles from "../styles/QuickActions.module.css";

import { Modal } from "./Modal";

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

const CATEGORY_ORDER = ["File", "Edit", "Tools", "View", "Help"];

/** The palette's own key, which closes it. */
const PALETTE_COMMANDS = ["app.palette"] as const;

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
  const id = useId();
  const optionId = (index: number) => `${id}-option-${index}`;

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
          // Close first: the action may open a dialog of its own.
          onClose();
          flattened[selectedIndex].onSelect();
        }
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

  const active = flattened[selectedIndex];

  return (
    <Modal
      label="Command palette"
      onClose={onClose}
      // Ctrl+K closes the palette it opened.
      commands={PALETTE_COMMANDS}
      scrimClassName={styles.scrim}
      scrimTestId="quick-actions-scrim"
      className={styles.panel}
      testId="quick-actions-panel"
    >
      <div className={styles.searchRow}>
        <span className={styles.prompt} aria-hidden="true">
          &gt;
        </span>
        <input
          ref={inputRef}
          className={styles.searchInput}
          type="text"
          role="combobox"
          aria-label="Search commands"
          aria-expanded="true"
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={active ? optionId(selectedIndex) : undefined}
          placeholder="Search actions..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          autoFocus
          data-testid="quick-actions-search"
        />
      </div>

      <div
        className={styles.list}
        ref={listRef}
        id={`${id}-list`}
        role="listbox"
        aria-label="Commands"
      >
        {flattened.length === 0 ? (
          <div className={styles.empty} role="presentation">
            No actions match "{query}"
          </div>
        ) : (
          CATEGORY_ORDER.filter((c) => grouped.has(c)).map((category) => (
            <div
              key={category}
              className={styles.category}
              role="group"
              aria-labelledby={`${id}-group-${category}`}
            >
              <div
                className={styles.categoryTitle}
                id={`${id}-group-${category}`}
                role="presentation"
              >
                {category}
              </div>
              {grouped.get(category)!.map((a) => {
                const idx = flattened.indexOf(a);
                return (
                  <div
                    key={a.id}
                    id={optionId(idx)}
                    role="option"
                    aria-selected={idx === selectedIndex}
                    className={[
                      styles.item,
                      idx === selectedIndex ? styles.itemSelected : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    data-action-index={idx}
                    data-testid={`quick-action-${a.id}`}
                    onClick={() => {
                      onClose();
                      a.onSelect();
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

      <div className={styles.footer} aria-hidden="true">
        <span>↑↓ Navigate</span>
        <span>Enter to select · Esc to close</span>
      </div>
    </Modal>
  );
}
