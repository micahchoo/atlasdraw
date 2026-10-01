import clsx from "clsx";

import { sceneCoordsToViewportCoords } from "@atlasdraw/common";
import { getElementAbsoluteCoords } from "@atlasdraw/element";

import type {
  ElementsMap,
  NonDeletedExcalidrawElement,
} from "@atlasdraw/element/types";

import { useExcalidrawAppState } from "../components/App";

import "./ElementCanvasButtons.scss";
import "./ToolIcon.scss";

import type { AppState } from "../types";
import type { ToolButtonSize } from "./ToolButton";
import type { JSX } from "react";

const CONTAINER_PADDING = 5;

const getContainerCoords = (
  element: NonDeletedExcalidrawElement,
  appState: AppState,
  elementsMap: ElementsMap,
) => {
  const [x1, y1] = getElementAbsoluteCoords(element, elementsMap);
  const { x: viewportX, y: viewportY } = sceneCoordsToViewportCoords(
    { sceneX: x1 + element.width, sceneY: y1 },
    appState,
  );
  const x = viewportX - appState.offsetLeft + 10;
  const y = viewportY - appState.offsetTop;
  return { x, y };
};

export const ElementCanvasButtons = ({
  children,
  element,
  elementsMap,
}: {
  children: React.ReactNode;
  element: NonDeletedExcalidrawElement;
  elementsMap: ElementsMap;
}) => {
  const appState = useExcalidrawAppState();

  if (
    appState.contextMenu ||
    appState.newElement ||
    appState.resizingElement ||
    appState.isRotating ||
    appState.openMenu ||
    appState.viewModeEnabled
  ) {
    return null;
  }

  const { x, y } = getContainerCoords(element, appState, elementsMap);

  return (
    <div
      className="excalidraw-canvas-buttons"
      style={{
        top: `${y}px`,
        left: `${x}px`,
        // width: CONTAINER_WIDTH,
        padding: CONTAINER_PADDING,
      }}
    >
      {children}
    </div>
  );
};

const ELEMENT_CANVAS_BUTTON_SIZE: ToolButtonSize = "small";

/** One toggle button inside `ElementCanvasButtons`. */
export const ElementCanvasButton = (props: {
  title?: string;
  icon: JSX.Element;
  name?: string;
  checked: boolean;
  onChange?(): void;
  isMobile?: boolean;
}) => {
  return (
    <label
      className={clsx(
        "ToolIcon ToolIcon__MagicButton",
        `ToolIcon_size_${ELEMENT_CANVAS_BUTTON_SIZE}`,
        {
          "is-mobile": props.isMobile,
        },
      )}
      title={`${props.title}`}
    >
      <input
        className="ToolIcon_type_checkbox"
        type="checkbox"
        name={props.name}
        onChange={props.onChange}
        checked={props.checked}
        aria-label={props.title}
      />
      <div className="ToolIcon__icon">{props.icon}</div>
    </label>
  );
};
