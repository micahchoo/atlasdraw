// SPDX-License-Identifier: AGPL-3.0-only
//
// Button — the app's one button. Every button the app draws is this one;
// Excalidraw's own buttons are not (they belong to the fork).
//
// - `variant`: "secondary" (the default), "primary" for the one action a
//   surface is for, "destructive" for an action that destroys, and
//   "ghost-icon" for a square button that shows only an icon or a glyph.
//   A ghost-icon button must have an `aria-label`: it has no visible text.
// - `size`: "md" (the default) in a dialog, "sm" in a panel, a popover or a
//   row.
// - `pressed`: makes the button a toggle. It sets `aria-pressed`, and the
//   look follows that attribute.
// - `type` is "button" unless set, so a press inside a form submits nothing.
// - `className` places the button (width, margin, flex). It does not
//   restyle it.
//
// The look is styles/Button.module.css, from tokens only.

import React from "react";

import styles from "../styles/Button.module.css";

type Common = Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "type" | "aria-pressed"
> & {
  size?: "sm" | "md";
  pressed?: boolean;
  type?: "button" | "submit";
  ref?: React.Ref<HTMLButtonElement>;
};

export type ButtonProps =
  | (Common & { variant?: "primary" | "secondary" | "destructive" })
  | (Common & { variant: "ghost-icon"; "aria-label": string });

const VARIANT = {
  primary: styles.primary,
  secondary: styles.secondary,
  destructive: styles.destructive,
  "ghost-icon": styles.ghostIcon,
};

export function Button({
  variant = "secondary",
  size = "md",
  pressed,
  type = "button",
  className,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      aria-pressed={pressed}
      className={[styles.button, styles[size], VARIANT[variant], className]
        .filter(Boolean)
        .join(" ")}
    />
  );
}
