// SPDX-License-Identifier: AGPL-3.0-only
//
// The app's one icon source. A component never draws its own icon <svg>
// (lib/__tests__/icons.test.tsx refuses one).
//
// Convention, for every icon here:
// - a 24×24 viewBox (tabler-icons, as Excalidraw's toolbar uses);
// - stroke and fill are `currentColor` or `none`, so the icon takes the
//   colour of the button around it;
// - the size comes from CSS through `className`, never from attributes;
// - `aria-hidden`: the button or the text beside the icon gives the name.
//
// Where the app shows a concept next to Excalidraw's own chrome (the tool
// strip, the sidebar that holds the Layers panel, a close button), the icon
// IS Excalidraw's, re-exported below, so the two match exactly. The icons
// drawn here are the ones Excalidraw does not have, and the comment icon,
// whose stroke a caller may set (the comment pin draws it at 12px).

import React, { cloneElement } from "react";

import {
  CloseIcon as ExcalidrawCloseIcon,
  DotsHorizontalIcon,
  PinIcon as ExcalidrawPinIcon,
  chevronRight,
  collapseDownIcon,
  collapseUpIcon,
  eyeClosedIcon,
  eyeIcon,
  searchIcon,
} from "@atlasdraw/excalidraw/components/icons";

import type { SVGProps } from "react";

export interface IconProps {
  className?: string;
}

/** An icon drawn here: tabler, 24×24, round caps and joins. */
interface DrawnIconProps extends IconProps {
  /** In viewBox units; 1.5 unless the icon sets its own. */
  strokeWidth?: number;
}

const drawn =
  (children: React.ReactNode, strokeWidth = 1.5) =>
  ({ className, strokeWidth: width = strokeWidth }: DrawnIconProps) =>
    (
      <svg
        aria-hidden="true"
        focusable="false"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={width}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
      >
        {children}
      </svg>
    );

/** One of Excalidraw's icons, as a component that takes a className. */
const excalidraw =
  (icon: React.ReactElement<SVGProps<SVGSVGElement>>) =>
  ({ className }: IconProps) =>
    cloneElement(icon, { className });

// ---------------------------------------------------------------------------
// Excalidraw's icons
// ---------------------------------------------------------------------------

/** The Pin tool, in Excalidraw's tool strip. */
export const PinIcon = excalidraw(ExcalidrawPinIcon);
/** The place search, beside Excalidraw's tool strip. */
export const SearchIcon = excalidraw(searchIcon);
/** Close a popup or a panel, as Excalidraw's dialogs do. */
export const CloseIcon = excalidraw(ExcalidrawCloseIcon);
/** A layer is shown / hidden (the Layers panel, in Excalidraw's sidebar). */
export const EyeIcon = excalidraw(eyeIcon);
export const EyeClosedIcon = excalidraw(eyeClosedIcon);
/** A row's actions menu. */
export const DotsIcon = excalidraw(DotsHorizontalIcon);
/** Move up / move down; a disclosure that is open / closed. */
export const ChevronUpIcon = excalidraw(collapseUpIcon);
export const ChevronDownIcon = excalidraw(collapseDownIcon);
export const ChevronRightIcon = excalidraw(chevronRight);

// ---------------------------------------------------------------------------
// Icons drawn here
// ---------------------------------------------------------------------------

/** tabler-icons: message-circle. The comment tool, and a comment's pin.
 * The same path as Excalidraw's messageCircleIcon; drawn here so the pin
 * can set a heavier stroke at its small size. */
export const CommentIcon = drawn(
  <path d="M3 20l1.3 -3.9c-2.324 -3.437 -1.426 -7.872 2.1 -10.374c3.526 -2.501 8.59 -2.296 11.845 .48c3.255 2.777 3.695 7.266 1.029 10.501c-2.666 3.235 -7.615 4.215 -11.574 2.293l-4.7 1" />,
  1.25,
);

/** tabler-icons: stack-2 — layered sheets (the sidebar's Layers tab). */
export const LayersIcon = drawn(
  <>
    <path d="M12 4l-8 4l8 4l8 -4l-8 -4" />
    <path d="M4 12l8 4l8 -4" />
    <path d="M4 16l8 4l8 -4" />
  </>,
);

/** tabler-icons: ruler-2 — the Measure tool. */
export const MeasureIcon = drawn(
  <>
    <path d="M17 3l4 4l-14 14l-4 -4z" />
    <path d="M16 7l-1.5 -1.5" />
    <path d="M13 10l-1.5 -1.5" />
    <path d="M10 13l-1.5 -1.5" />
    <path d="M7 16l-1.5 -1.5" />
  </>,
);

/** tabler-icons: grip-vertical — a layer row's drag handle. */
export const GripIcon = drawn(
  <>
    <path d="M9 5m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" />
    <path d="M9 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" />
    <path d="M9 19m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" />
    <path d="M15 5m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" />
    <path d="M15 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" />
    <path d="M15 19m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" />
  </>,
);
