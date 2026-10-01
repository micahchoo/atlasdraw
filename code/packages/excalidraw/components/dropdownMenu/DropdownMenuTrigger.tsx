import clsx from "clsx";

import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";

import { useEditorInterface } from "../App";

// The menu's open state is the editor's (appState.openMenu), so Radix's own
// keyboard toggle changes nothing, and Radix stops the click that Enter or
// Space would make. The trigger therefore opens on the key itself: Enter and
// Space toggle, ArrowDown opens.
const MenuTrigger = ({
  className = "",
  children,
  onToggle,
  title,
  onKeyDown,
  ...rest
}: {
  className?: string;
  children: React.ReactNode;
  onToggle: () => void;
  title?: string;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onSelect">) => {
  const editorInterface = useEditorInterface();
  const classNames = clsx(
    `dropdown-menu-button ${className}`,
    "zen-mode-transition",
    {
      "dropdown-menu-button--mobile": editorInterface.formFactor === "phone",
    },
  ).trim();
  return (
    <DropdownMenuPrimitive.Trigger
      className={classNames}
      onClick={onToggle}
      type="button"
      data-testid="dropdown-menu-button"
      title={title}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented) {
          return;
        }
        const open =
          event.currentTarget.getAttribute("aria-expanded") === "true";
        if (
          event.key === "Enter" ||
          event.key === " " ||
          (event.key === "ArrowDown" && !open)
        ) {
          onToggle();
        }
      }}
      {...rest}
    >
      {children}
    </DropdownMenuPrimitive.Trigger>
  );
};

export default MenuTrigger;
MenuTrigger.displayName = "DropdownMenuTrigger";
