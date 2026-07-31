// SPDX-License-Identifier: AGPL-3.0-only
//
// Shared icon components for atlas-app, rendered through the same `createIcon`
// + `tablerIconProps` pattern used by the native Excalidraw toolbar buttons
// (packages/excalidraw/components/icons.tsx). This keeps atlas toolbar/sidebar
// icons visually consistent with the native drawing-tool icons beside them.

import React from "react";

import type { SVGProps } from "react";

type IconOpts = {
  width?: number;
  height?: number;
} & SVGProps<SVGSVGElement>;

/**
 * Wraps children in a consistent SVG shell matching Excalidraw's `createIcon`.
 * All atlas toolbar icons flow through this so they share the same viewBox,
 * stroke, and fill conventions as the native tool icons.
 */
export const createIcon = (children: React.ReactNode, opts: IconOpts = {}) => {
  const { width = 24, height = width, ...rest } = opts;
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      role="img"
      viewBox={`0 0 ${width} ${height}`}
      {...rest}
    >
      {children}
    </svg>
  );
};

/** Props shared by tabler-derived icons — viewBox, stroke, line joins. */
const tablerIconProps: IconOpts = {
  width: 24,
  height: 24,
  fill: "none",
  strokeWidth: 2,
  stroke: "currentColor",
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

/** tabler-icons: pinned — push-pin / tack. */
export const PinIcon = ({ className }: { className?: string }) =>
  createIcon(
    <svg strokeWidth="1.5">
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M9 4v6l-2 4v2h10v-2l-2 -4v-6" />
      <line x1="12" y1="16" x2="12" y2="21" />
      <line x1="8" y1="4" x2="16" y2="4" />
    </svg>,
    { ...tablerIconProps, className },
  );

/** tabler-icons: message-circle — chat bubble. */
export const CommentModeIcon = ({ className }: { className?: string }) =>
  createIcon(
    <g strokeWidth="1.25">
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M3 20l1.3 -3.9c-2.324 -3.437 -1.426 -7.872 2.1 -10.374c3.526 -2.501 8.59 -2.296 11.845 .48c3.255 2.777 3.695 7.266 1.029 10.501c-2.666 3.235 -7.615 4.215 -11.574 2.293l-4.7 1" />
    </g>,
    { ...tablerIconProps, className },
  );

/** tabler-icons: stack-2 — layered sheets (sidebar Layers tab). */
export const LayersIcon = ({ className }: { className?: string }) =>
  createIcon(
    <g strokeWidth="1.5">
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M12 4l-8 4l8 4l8 -4l-8 -4" />
      <path d="M4 12l8 4l8 -4" />
      <path d="M4 16l8 4l8 -4" />
    </g>,
    { ...tablerIconProps, className },
  );
