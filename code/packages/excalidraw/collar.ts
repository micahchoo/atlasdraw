// SPDX-License-Identifier: AGPL-3.0-only
// Atlasdraw fork addition (ADR-0010, Collar shell).

/**
 * Is the collar treatment in force?
 *
 * True when the host has portaled the toolbar into its own frame and this is not
 * a phone: desktop chrome then renders flush into the app's frame instead of
 * floating over the canvas, and the sidebar becomes the sheet's right margin
 * (`.excalidraw--collar` in Sidebar.scss). Stock island layout is untouched when
 * the host passes no target, and the phone layout always ignores it.
 *
 * One function rather than the expression written out at each site, because it
 * is consumed in two files that cannot see each other's copy: App.tsx publishes
 * the container class from it, and LayerUI.tsx both branches its own layout on
 * it and reports it to the host through `onSidebarLayoutChange`. A host placing
 * chrome at the panel's edge depends on the class and the callback field
 * agreeing, and two textually identical expressions agree only until someone
 * edits one. Same reasoning as `isUIShrunkForSidebar`, which is one variable
 * with three readers for exactly this reason — that one just happens to fit in
 * a single component.
 */
export const isCollarMode = (
  collarToolbarTarget: HTMLElement | null | undefined,
  formFactor: string,
): boolean => collarToolbarTarget != null && formFactor !== "phone";
