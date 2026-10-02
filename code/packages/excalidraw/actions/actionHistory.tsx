import { useSyncExternalStore } from "react";

import {
  isWindows,
  KEYS,
  matchKey,
  arrayToMap,
  MOBILE_ACTION_BUTTON_BG,
} from "@atlasdraw/common";

import { CaptureUpdateAction } from "@atlasdraw/element";

import { orderByFractionalIndex } from "@atlasdraw/element";

import type { SceneElementsMap } from "@atlasdraw/element/types";

import { ToolButton } from "../components/ToolButton";
import { UndoIcon, RedoIcon } from "../components/icons";
import { t } from "../i18n";

import { useStylesPanelMode } from "../components/App";

import type { History } from "../history";
import type { AppClassProperties, AppState, HistoryHost } from "../types";
import type { Action, ActionResult } from "./types";

export const executeHistoryAction = (
  app: AppClassProperties,
  appState: Readonly<AppState>,
  updater: () => [SceneElementsMap, AppState] | void,
): ActionResult => {
  if (
    !appState.multiElement &&
    !appState.resizingElement &&
    !appState.editingTextElement &&
    !appState.newElement &&
    !appState.selectedElementsAreBeingDragged &&
    !appState.selectionElement &&
    !app.flowChartCreator.isCreatingChart
  ) {
    const result = updater();

    if (!result) {
      return { captureUpdate: CaptureUpdateAction.EVENTUALLY };
    }

    const [nextElementsMap, nextAppState] = result;

    // order by fractional indices in case the map was accidently modified in the meantime
    const nextElements = orderByFractionalIndex(
      Array.from(nextElementsMap.values()),
    );

    return {
      appState: nextAppState,
      elements: nextElements,
      captureUpdate: CaptureUpdateAction.NEVER,
    };
  }

  return { captureUpdate: CaptureUpdateAction.EVENTUALLY };
};

type ActionCreator = (history: History) => Action;

/**
 * Whether the undo or redo button is enabled: the host's answer when the
 * host owns undo (Atlasdraw addition, `historyHost`), else the drawing's
 * own stack.
 */
const useCanStep = (
  history: History,
  host: HistoryHost | undefined,
  kind: "undo" | "redo",
): boolean =>
  useSyncExternalStore(
    (listener) =>
      host
        ? host.subscribe(listener)
        : history.onHistoryChangedEmitter.on(listener),
    () =>
      host
        ? kind === "undo"
          ? host.canUndo()
          : host.canRedo()
        : kind === "undo"
        ? !history.isUndoStackEmpty
        : !history.isRedoStackEmpty,
  );

export const createUndoAction: ActionCreator = (history) => ({
  name: "undo",
  label: "buttons.undo",
  icon: UndoIcon,
  trackEvent: { category: "history" },
  viewMode: false,
  perform: (elements, appState, value, app) => {
    if (app.props.historyHost) {
      app.props.historyHost.undo();
      return false;
    }
    return executeHistoryAction(app, appState, () =>
      history.undo(arrayToMap(elements) as SceneElementsMap, appState),
    );
  },
  keyTest: (event) =>
    event[KEYS.CTRL_OR_CMD] && matchKey(event, KEYS.Z) && !event.shiftKey,
  PanelComponent: ({ appState, updateData, data, app }) => {
    const canUndo = useCanStep(history, app.props.historyHost, "undo");
    const isMobile = useStylesPanelMode() === "mobile";

    return (
      <ToolButton
        type="button"
        icon={UndoIcon}
        aria-label={t("buttons.undo")}
        onClick={updateData}
        size={data?.size || "medium"}
        disabled={!canUndo}
        data-testid="button-undo"
        style={{
          ...(isMobile ? MOBILE_ACTION_BUTTON_BG : {}),
        }}
      />
    );
  },
});

export const createRedoAction: ActionCreator = (history) => ({
  name: "redo",
  label: "buttons.redo",
  icon: RedoIcon,
  trackEvent: { category: "history" },
  viewMode: false,
  perform: (elements, appState, __, app) => {
    if (app.props.historyHost) {
      app.props.historyHost.redo();
      return false;
    }
    return executeHistoryAction(app, appState, () =>
      history.redo(arrayToMap(elements) as SceneElementsMap, appState),
    );
  },
  keyTest: (event) =>
    (event[KEYS.CTRL_OR_CMD] && event.shiftKey && matchKey(event, KEYS.Z)) ||
    (isWindows && event.ctrlKey && !event.shiftKey && matchKey(event, KEYS.Y)),
  PanelComponent: ({ appState, updateData, data, app }) => {
    const canRedo = useCanStep(history, app.props.historyHost, "redo");
    const isMobile = useStylesPanelMode() === "mobile";

    return (
      <ToolButton
        type="button"
        icon={RedoIcon}
        aria-label={t("buttons.redo")}
        onClick={updateData}
        size={data?.size || "medium"}
        disabled={!canRedo}
        data-testid="button-redo"
        style={{
          ...(isMobile ? MOBILE_ACTION_BUTTON_BG : {}),
        }}
      />
    );
  },
});
