// SPDX-License-Identifier: AGPL-3.0-only
//
// Modal: the one way a dialog is modal. Every dialog in the editor renders
// its scrim and panel through it, and gets the same behaviour:
//
//   - The panel is a `dialog` (or `alertdialog`), `aria-modal`, and named:
//     by a visible heading (`labelledBy`) or by `label`.
//   - Focus moves into the panel when it opens, and Tab and Shift+Tab stay
//     inside it (react-aria's FocusScope).
//   - Escape closes it. Escape is a key scope on the editor's stack
//     (commands/keyScopes.ts), so only the newest dialog hears it, and no
//     tool below does. Outside an editor the Modal keeps a stack of its own.
//   - A press on the scrim closes it, measured at mousedown on the scrim
//     itself: a click that started in the panel is not a press outside.
//   - The page behind it is inert while it is open. Live regions stay, so
//     a toast that arrives while a dialog is open is still read out.
//   - When it closes, focus goes back to what opened it: the element the
//     dialog slot names (ReturnFocusContext), or else the element that had
//     focus when the Modal first rendered.
//
// A question inside a dialog is a Modal inside a Modal. It goes on the stack
// above the first, makes the first inert, and gives focus back to the button
// that asked it.

import { FocusScope } from "@react-aria/focus";
import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  KeyScopesContext,
  createKeyScopes,
  useKeyScopes,
  type KeyScope,
} from "../commands/keyScopes";
import { returnFocusTo } from "../session/focusReturn";

/**
 * Where the dialog in the slot gives focus back (view.returnFocus). Unset
 * (undefined) for a dialog outside the slot: it reads its own opener.
 */
export const ReturnFocusContext = createContext<Element | null | undefined>(
  undefined,
);

/** Elements that stay out of the inert page: they speak, they do not take focus. */
const LIVE = '[aria-live], [role="status"], [role="alert"], [data-live-region]';

/** Make every element beside the path from `el` to the body inert. */
function inertAround(el: Element): () => void {
  const made: Element[] = [];
  for (
    let node: Element | null = el;
    node && node !== document.body;
    node = node.parentElement
  ) {
    for (const sibling of Array.from(node.parentElement?.children ?? [])) {
      if (
        sibling === node ||
        sibling.hasAttribute("inert") ||
        sibling.matches(LIVE)
      ) {
        continue;
      }
      sibling.setAttribute("inert", "");
      made.push(sibling);
    }
  }
  return () => made.forEach((m) => m.removeAttribute("inert"));
}

// @react-aria/focus declares `children` against its own @types/react, which
// TypeScript sees as a different ReactNode. The runtime value is the same.
const Scope = FocusScope as unknown as React.FC<{
  contain?: boolean;
  restoreFocus?: boolean;
  autoFocus?: boolean;
  children?: React.ReactNode;
}>;

export interface ModalProps {
  /** Escape, a press on the scrim, and the dialog's own Close all call it. */
  onClose: () => void;
  /** The dialog's name, when no visible heading names it. */
  label?: string;
  /** The id of the visible heading that names the dialog. */
  labelledBy?: string;
  describedBy?: string;
  /** "alertdialog": a question that interrupts the user. */
  role?: "dialog" | "alertdialog";
  /** False: a press on the scrim does nothing (onboarding). */
  scrimCloses?: boolean;
  /**
   * The commands whose keys still run while this dialog is on top: its own
   * toggle (⌘K closes the palette). Every other command waits.
   */
  commands?: readonly string[];
  scrimClassName?: string;
  scrimStyle?: React.CSSProperties;
  scrimTestId?: string;
  className?: string;
  style?: React.CSSProperties;
  testId?: string;
  panelRef?: React.Ref<HTMLDivElement>;
  children: React.ReactNode;
}

export function Modal({
  onClose,
  label,
  labelledBy,
  describedBy,
  role = "dialog",
  scrimCloses = true,
  commands,
  scrimClassName,
  scrimStyle,
  scrimTestId,
  className,
  style,
  testId,
  panelRef,
  children,
}: ModalProps) {
  const outer = useKeyScopes();
  const [own] = useState(() => (outer ? null : createKeyScopes()));
  const keys = outer ?? own!;

  // Read in the first render, before the commit moves focus into the panel.
  const fromSlot = useContext(ReturnFocusContext);
  const [opener] = useState(() =>
    fromSlot !== undefined ? fromSlot : document.activeElement,
  );

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const commandsRef = useRef(commands);
  commandsRef.current = commands;

  const scope = useMemo<KeyScope>(
    () => ({
      name: label ?? labelledBy ?? "dialog",
      layer: "dialog",
      get commands() {
        return commandsRef.current;
      },
      onKey: (e) => {
        if (e.key !== "Escape") {
          return false;
        }
        onCloseRef.current();
        return true;
      },
    }),
    [label, labelledBy],
  );
  useEffect(() => keys.push(scope), [keys, scope]);

  const scrimRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const restore = scrimRef.current ? inertAround(scrimRef.current) : null;
    return () => {
      restore?.();
      returnFocusTo(opener);
    };
  }, [opener]);

  return (
    <KeyScopesContext.Provider value={keys}>
      <ReturnFocusContext.Provider value={undefined}>
        <div
          ref={scrimRef}
          className={scrimClassName}
          style={scrimStyle}
          data-testid={scrimTestId}
          onMouseDown={(e) => {
            if (scrimCloses && e.target === e.currentTarget) {
              onCloseRef.current();
            }
          }}
        >
          <Scope contain autoFocus>
            <div
              ref={panelRef}
              role={role}
              aria-modal="true"
              aria-label={labelledBy ? undefined : label}
              aria-labelledby={labelledBy}
              aria-describedby={describedBy}
              className={className}
              style={style}
              data-testid={testId}
            >
              {children}
            </div>
          </Scope>
        </div>
      </ReturnFocusContext.Provider>
    </KeyScopesContext.Provider>
  );
}
