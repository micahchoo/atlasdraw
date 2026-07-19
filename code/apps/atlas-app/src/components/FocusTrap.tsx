// SPDX-License-Identifier: AGPL-3.0-only
// Phase 6 A14a — FocusTrap.
//
// Thin wrapper over `@react-aria/focus`'s FocusScope. We share one canonical
// trap across every atlas-app modal (BasemapPickerDialog, MaputnikDialog,
// ExportDialog, AssetLibraryPanel, StylePanel, ShareDialog) so they all get:
//   - contain   — Tab/Shift+Tab cycle within the modal, never escape it.
//   - restoreFocus — when the modal unmounts, focus returns to whichever
//     element opened it (the menu item, button, etc).
//   - autoFocus — first focusable child receives focus on mount.
//
// References (WAI-ARIA Authoring Practices for dialog focus management):
//   https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
//
// We deliberately keep each modal's existing Escape + click-outside handling
// intact — FocusScope only owns focus order. Closing the modal is still the
// modal's job (and that triggers FocusScope's restoreFocus on unmount).

import React from "react";
import { FocusScope } from "@react-aria/focus";

export interface FocusTrapProps {
  /**
   * When true (default), Tab and Shift+Tab cycle inside the trap. When false,
   * focus may move outside (useful for tests or non-modal popovers).
   */
  contain?: boolean;
  /**
   * When true (default), focus returns to the previously focused element when
   * the trap unmounts.
   */
  restoreFocus?: boolean;
  /**
   * When true (default), the first focusable descendant receives focus on
   * mount. Modals that ref-focus a specific button (e.g. a Close `×`) should
   * still set `autoFocus={true}` here — react-aria's FocusScope honours any
   * manual `.focus()` call once mounted, so the modal's existing
   * `closeBtnRef.current?.focus()` still wins.
   */
  autoFocus?: boolean;
  children: React.ReactNode;
}

export const FocusTrap: React.FC<FocusTrapProps> = ({
  contain = true,
  restoreFocus = true,
  autoFocus = true,
  children,
}) => {
  // @react-aria/focus declares `children: ReactNode` against an internal
  // @types/react resolution that TypeScript sees as nominally distinct from
  // ours, even though the structural type matches. Cast the component to a
  // ReactNode-accepting variant — the runtime value is unchanged.
  const Scope = FocusScope as unknown as React.FC<{
    contain?: boolean;
    restoreFocus?: boolean;
    autoFocus?: boolean;
    children?: React.ReactNode;
  }>;
  return (
    <Scope contain={contain} restoreFocus={restoreFocus} autoFocus={autoFocus}>
      {children}
    </Scope>
  );
};
