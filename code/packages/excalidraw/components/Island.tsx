import React from "react";
import clsx from "clsx";

import "./Island.scss";

type IslandProps = {
  children: React.ReactNode;
  padding?: number;
  className?: string | boolean;
  style?: object;
  /**
   * Atlasdraw fork addition — forwarded to the DOM node. `DefaultSidebar`
   * needs a stable `id` on its island so a host-app trigger rail outside the
   * editor's React tree has an `aria-controls` target.
   */
  id?: string;
};

export const Island = React.forwardRef<HTMLDivElement, IslandProps>(
  ({ children, padding, className, style, id }, ref) => (
    <div
      id={id}
      className={clsx("Island", className)}
      style={{ "--padding": padding, ...style }}
      ref={ref}
    >
      {children}
    </div>
  ),
);
