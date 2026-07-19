import clsx from "clsx";
import React from "react";
import { createPortal } from "react-dom";

import {
  CLASSES,
  DEFAULT_SIDEBAR,
  TOOL_TYPE,
  arrayToMap,
  capitalizeString,
  isShallowEqual,
} from "@atlasdraw/common";

import { mutateElement } from "@atlasdraw/element";

import { showSelectedShapeActions } from "@atlasdraw/element";

import { ShapeCache } from "@atlasdraw/element";

import type { NonDeletedExcalidrawElement } from "@atlasdraw/element/types";

import { actionToggleStats } from "../actions";
import { trackEvent } from "../analytics";
import { TunnelsContext, useInitializeTunnels } from "../context/tunnels";
import { UIAppStateContext } from "../context/ui-appState";
import { useAtom, useAtomValue } from "../editor-jotai";

import { t } from "../i18n";
import { calculateScrollCenter } from "../scene";

import {
  SelectedShapeActions,
  ShapesSwitcher,
  CompactShapeActions,
  UndoRedoActions,
} from "./Actions";
import { LoadingMessage } from "./LoadingMessage";
import { LockButton } from "./LockButton";
import { MobileMenu } from "./MobileMenu";
import { PasteChartDialog } from "./PasteChartDialog";
import { Section } from "./Section";
import Stack from "./Stack";
import { UserList } from "./UserList";
import { PenModeButton } from "./PenModeButton";
import Footer from "./footer/Footer";
import { isSidebarDockedAtom } from "./Sidebar/Sidebar";
import MainMenu from "./main-menu/MainMenu";
import { ActiveConfirmDialog } from "./ActiveConfirmDialog";
import { useEditorInterface, useStylesPanelMode } from "./App";
import { OverwriteConfirmDialog } from "./OverwriteConfirm/OverwriteConfirm";
import { sidebarRightIcon } from "./icons";
import { DefaultSidebar } from "./DefaultSidebar";
import { TTDDialog } from "./TTDDialog/TTDDialog";
import { Stats } from "./Stats";
import ElementLinkDialog from "./ElementLinkDialog";
import { ErrorDialog } from "./ErrorDialog";
import { EyeDropper, activeEyeDropperAtom } from "./EyeDropper";
import { FixedSideContainer } from "./FixedSideContainer";
import { HelpDialog } from "./HelpDialog";
import { HintViewer } from "./HintViewer";
import { ImageExportDialog } from "./ImageExportDialog";
import { Island } from "./Island";
import { JSONExportDialog } from "./JSONExportDialog";
import { LaserPointerButton } from "./LaserPointerButton";
import { Toast } from "./Toast";

import "./LayerUI.scss";
import "./Toolbar.scss";

import type { ActionManager } from "../actions/manager";

import type { Language } from "../i18n";
import type {
  AppProps,
  AppState,
  ExcalidrawProps,
  BinaryFiles,
  UIAppState,
  AppClassProperties,
} from "../types";

interface LayerUIProps {
  actionManager: ActionManager;
  appState: UIAppState;
  files: BinaryFiles;
  canvas: HTMLCanvasElement;
  setAppState: React.Component<any, AppState>["setState"];
  elements: readonly NonDeletedExcalidrawElement[];
  onLockToggle: () => void;
  onHandToolToggle: () => void;
  onPenModeToggle: AppClassProperties["togglePenMode"];
  showExitZenModeBtn: boolean;
  langCode: Language["code"];
  renderTopLeftUI?: ExcalidrawProps["renderTopLeftUI"];
  renderTopRightUI?: ExcalidrawProps["renderTopRightUI"];
  renderToolbarExtras?: ExcalidrawProps["renderToolbarExtras"];
  collarToolbarTarget?: ExcalidrawProps["collarToolbarTarget"];
  collarMenuTarget?: ExcalidrawProps["collarMenuTarget"];
  onScrollBackToContent?: ExcalidrawProps["onScrollBackToContent"];
  renderCustomStats?: ExcalidrawProps["renderCustomStats"];
  UIOptions: AppProps["UIOptions"];
  onExportImage: AppClassProperties["onExportImage"];
  renderWelcomeScreen: boolean;
  children?: React.ReactNode;
  app: AppClassProperties;
  isCollaborating: boolean;
  generateLinkForSelection?: AppProps["generateLinkForSelection"];
}

const DefaultMainMenu: React.FC<{
  UIOptions: AppProps["UIOptions"];
}> = ({ UIOptions }) => {
  return (
    <MainMenu __fallback>
      <MainMenu.DefaultItems.LoadScene />
      <MainMenu.DefaultItems.SaveToActiveFile />
      {/* FIXME we should to test for this inside the item itself */}
      {UIOptions.canvasActions.export && <MainMenu.DefaultItems.Export />}
      {/* FIXME we should to test for this inside the item itself */}
      {UIOptions.canvasActions.saveAsImage && (
        <MainMenu.DefaultItems.SaveAsImage />
      )}
      <MainMenu.DefaultItems.SearchMenu />
      <MainMenu.DefaultItems.Help />
      <MainMenu.DefaultItems.ClearCanvas />
      <MainMenu.Separator />
      <MainMenu.Group title="Excalidraw links">
        <MainMenu.DefaultItems.Socials />
      </MainMenu.Group>
      <MainMenu.Separator />
      <MainMenu.DefaultItems.ToggleTheme />
      <MainMenu.DefaultItems.ChangeCanvasBackground />
    </MainMenu>
  );
};

const DefaultOverwriteConfirmDialog = () => {
  return (
    <OverwriteConfirmDialog __fallback>
      <OverwriteConfirmDialog.Actions.SaveToDisk />
      <OverwriteConfirmDialog.Actions.ExportToImage />
    </OverwriteConfirmDialog>
  );
};

const LayerUI = ({
  actionManager,
  appState,
  files,
  setAppState,
  elements,
  canvas,
  onLockToggle,
  onHandToolToggle,
  onPenModeToggle,
  showExitZenModeBtn,
  renderTopLeftUI,
  renderTopRightUI,
  renderToolbarExtras,
  collarToolbarTarget,
  collarMenuTarget,
  onScrollBackToContent,
  renderCustomStats,
  UIOptions,
  onExportImage,
  renderWelcomeScreen,
  children,
  app,
  isCollaborating,
  generateLinkForSelection,
}: LayerUIProps) => {
  const editorInterface = useEditorInterface();
  const stylesPanelMode = useStylesPanelMode();
  const isCompactStylesPanel = stylesPanelMode === "compact";
  const tunnels = useInitializeTunnels();

  const spacing = isCompactStylesPanel
    ? {
        menuTopGap: 4,
        toolbarColGap: 4,
        toolbarRowGap: 1,
        toolbarInnerRowGap: 0.5,
        islandPadding: 1,
        collabMarginLeft: 8,
      }
    : {
        menuTopGap: 6,
        toolbarColGap: 4,
        toolbarRowGap: 1,
        toolbarInnerRowGap: 1,
        islandPadding: 1,
        collabMarginLeft: 8,
      };

  const TunnelsJotaiProvider = tunnels.tunnelsJotai.Provider;

  const [eyeDropperState, setEyeDropperState] = useAtom(activeEyeDropperAtom);

  // Atlasdraw Collar shell (ADR-0010): when the host app provides a collar
  // toolbar target, desktop chrome renders flush into the app's frame (via
  // portals) instead of floating over the canvas. Stock island layout is
  // untouched when the prop is absent; the phone layout always ignores it.
  const collarMode =
    collarToolbarTarget != null && editorInterface.formFactor !== "phone";
  const menuInCollar = collarMode && collarMenuTarget != null;

  const shouldRenderToolbar =
    !appState.viewModeEnabled &&
    appState.openDialog?.name !== "elementLinkSelector";

  const shouldRenderSelectedShapeActions = showSelectedShapeActions(
    appState,
    elements,
  );

  const renderJSONExportDialog = () => {
    if (!UIOptions.canvasActions.export) {
      return null;
    }

    return (
      <JSONExportDialog
        elements={elements}
        appState={appState}
        files={files}
        actionManager={actionManager}
        exportOpts={UIOptions.canvasActions.export}
        canvas={canvas}
        setAppState={setAppState}
      />
    );
  };

  const renderImageExportDialog = () => {
    if (
      !UIOptions.canvasActions.saveAsImage ||
      appState.openDialog?.name !== "imageExport"
    ) {
      return null;
    }

    return (
      <ImageExportDialog
        elements={elements}
        appState={appState}
        files={files}
        actionManager={actionManager}
        onExportImage={onExportImage}
        onCloseRequest={() => setAppState({ openDialog: null })}
        name={app.getName()}
      />
    );
  };

  const renderCanvasActions = () => (
    <div style={{ position: "relative" }}>
      {/* wrapping to Fragment stops React from occasionally complaining
                about identical Keys */}
      <tunnels.MainMenuTunnel.Out />
      {renderWelcomeScreen && <tunnels.WelcomeScreenMenuHintTunnel.Out />}
    </div>
  );

  const renderSelectedShapeActions = () => {
    const isCompactMode = isCompactStylesPanel;

    return (
      <Section
        heading="selectedShapeActions"
        className={clsx("selected-shape-actions zen-mode-transition", {
          "transition-left": appState.zenModeEnabled,
        })}
      >
        {isCompactMode ? (
          <Island
            className={clsx("compact-shape-actions-island")}
            padding={0}
            style={{
              // we want to make sure this doesn't overflow so subtracting the
              // approximate height of hamburgerMenu + footer
              maxHeight: `${appState.height - 166}px`,
            }}
          >
            <CompactShapeActions
              appState={appState}
              elementsMap={app.scene.getNonDeletedElementsMap()}
              renderAction={actionManager.renderAction}
              app={app}
              setAppState={setAppState}
            />
          </Island>
        ) : (
          <Island
            className={CLASSES.SHAPE_ACTIONS_MENU}
            padding={2}
            style={{
              // we want to make sure this doesn't overflow so subtracting the
              // approximate height of hamburgerMenu + footer
              maxHeight: `${appState.height - 166}px`,
            }}
          >
            <SelectedShapeActions
              appState={appState}
              elementsMap={app.scene.getNonDeletedElementsMap()}
              renderAction={actionManager.renderAction}
              app={app}
            />
          </Island>
        )}
      </Section>
    );
  };

  const renderFixedSideContainer = () => {
    const shouldShowStats =
      appState.stats.open &&
      !appState.zenModeEnabled &&
      !appState.viewModeEnabled &&
      appState.openDialog?.name !== "elementLinkSelector";

    return (
      <FixedSideContainer side="top">
        <div className="App-menu App-menu_top">
          {/* Collar mode: the toolbar (and its HintViewer host Island) are
            portaled into the app frame, so tool hints get their own
            full-width host at the top of the canvas area instead. */}
          {collarMode && (
            <div className="App-collar-hint-host">
              {/* collar mode is desktop/tablet only — isMobile is false */}
              <HintViewer
                appState={appState}
                isMobile={false}
                editorInterface={editorInterface}
                app={app}
              />
            </div>
          )}
          <Stack.Col
            gap={spacing.menuTopGap}
            className={clsx("App-menu_top__left")}
          >
            {!menuInCollar && renderCanvasActions()}
            <div
              className={clsx("selected-shape-actions-container", {
                "selected-shape-actions-container--compact":
                  isCompactStylesPanel,
              })}
            >
              {/* collar mode: the properties panel renders as the LEGEND at
                the right frame edge instead (renderCollarLegend below). */}
              {!collarMode &&
                shouldRenderSelectedShapeActions &&
                renderSelectedShapeActions()}
            </div>
          </Stack.Col>
          {!collarMode && shouldRenderToolbar && (
            <Section heading="shapes" className="shapes-section">
              {(heading: React.ReactNode) => (
                <div style={{ position: "relative" }}>
                  {renderWelcomeScreen && (
                    <tunnels.WelcomeScreenToolbarHintTunnel.Out />
                  )}
                  <Stack.Col gap={spacing.toolbarColGap} align="start">
                    <Stack.Row
                      gap={spacing.toolbarRowGap}
                      className={clsx("App-toolbar-container", {
                        "zen-mode": appState.zenModeEnabled,
                      })}
                    >
                      <Island
                        padding={spacing.islandPadding}
                        className={clsx("App-toolbar", {
                          "zen-mode": appState.zenModeEnabled,
                          "App-toolbar--compact": isCompactStylesPanel,
                        })}
                      >
                        <HintViewer
                          appState={appState}
                          isMobile={editorInterface.formFactor === "phone"}
                          editorInterface={editorInterface}
                          app={app}
                        />
                        {heading}
                        <Stack.Row gap={spacing.toolbarInnerRowGap}>
                          <PenModeButton
                            zenModeEnabled={appState.zenModeEnabled}
                            checked={appState.penMode}
                            onChange={() => onPenModeToggle(null)}
                            title={t("toolBar.penMode")}
                            penDetected={appState.penDetected}
                          />
                          <LockButton
                            checked={appState.activeTool.locked}
                            onChange={onLockToggle}
                            title={t("toolBar.lock")}
                          />

                          <div className="App-toolbar__divider" />

                          <ShapesSwitcher
                            setAppState={setAppState}
                            activeTool={appState.activeTool}
                            UIOptions={UIOptions}
                            app={app}
                          />
                          {/* Atlasdraw addition: host for atlas-app controls
                              (geo-search) that sit on the same toolbar as the
                              drawing tools. Generic slot — no atlas import here;
                              the app injects content via the renderToolbarExtras
                              prop. */}
                          {renderToolbarExtras && (
                            <>
                              <div className="App-toolbar__divider" />
                              {renderToolbarExtras(
                                editorInterface.formFactor === "phone",
                                appState,
                              )}
                            </>
                          )}
                        </Stack.Row>
                      </Island>
                      {isCollaborating && (
                        <Island
                          style={{
                            marginLeft: spacing.collabMarginLeft,
                            alignSelf: "center",
                            height: "fit-content",
                          }}
                        >
                          <LaserPointerButton
                            title={t("toolBar.laser")}
                            checked={
                              appState.activeTool.type === TOOL_TYPE.laser
                            }
                            onChange={() =>
                              app.setActiveTool({ type: TOOL_TYPE.laser })
                            }
                            isMobile
                          />
                        </Island>
                      )}
                    </Stack.Row>
                  </Stack.Col>
                </div>
              )}
            </Section>
          )}
          <div
            className={clsx(
              "layer-ui__wrapper__top-right zen-mode-transition",
              {
                "transition-right": appState.zenModeEnabled,
                "layer-ui__wrapper__top-right--compact": isCompactStylesPanel,
              },
            )}
          >
            {appState.collaborators.size > 0 && (
              <UserList
                collaborators={appState.collaborators}
                userToFollow={appState.userToFollow?.socketId || null}
              />
            )}
            {renderTopRightUI?.(
              editorInterface.formFactor === "phone",
              appState,
            )}
            {/* collar mode: the sidebar opens via the app's sheet-edge tabs
              in the collar frame — no floating trigger button. */}
            {!collarMode &&
              !appState.viewModeEnabled &&
              appState.openDialog?.name !== "elementLinkSelector" &&
              // hide button when sidebar docked
              (!isSidebarDocked ||
                appState.openSidebar?.name !== DEFAULT_SIDEBAR.name) && (
                <tunnels.DefaultSidebarTriggerTunnel.Out />
              )}
            {shouldShowStats && (
              <Stats
                app={app}
                onClose={() => {
                  actionManager.executeAction(actionToggleStats);
                }}
                renderCustomStats={renderCustomStats}
              />
            )}
          </div>
        </div>
      </FixedSideContainer>
    );
  };

  // Atlasdraw Collar shell (ADR-0010): the shapes toolbar as a flush,
  // full-width strip portaled into the app's collar tool row. The wrapper
  // re-establishes the `.excalidraw` scope (CSS custom properties) because
  // the collar rows live outside the editor container. No Island — the
  // collar frame provides the surface.
  const renderCollarToolbar = () => {
    if (!collarMode || !collarToolbarTarget || !shouldRenderToolbar) {
      return null;
    }
    return createPortal(
      <div className="excalidraw App-collar-host App-collar-strip-host">
        <Section heading="shapes" className="App-collar-shapes-section">
          {(heading: React.ReactNode) => (
            <div
              className={clsx(
                "App-collar-strip App-toolbar App-toolbar-container",
                { "App-toolbar--compact": isCompactStylesPanel },
              )}
            >
              {heading}
              <PenModeButton
                zenModeEnabled={appState.zenModeEnabled}
                checked={appState.penMode}
                onChange={() => onPenModeToggle(null)}
                title={t("toolBar.penMode")}
                penDetected={appState.penDetected}
              />
              <LockButton
                checked={appState.activeTool.locked}
                onChange={onLockToggle}
                title={t("toolBar.lock")}
              />
              <div className="App-toolbar__divider" />
              <ShapesSwitcher
                setAppState={setAppState}
                activeTool={appState.activeTool}
                UIOptions={UIOptions}
                app={app}
              />
              {renderToolbarExtras && (
                <>
                  <div className="App-toolbar__divider" />
                  {/* collar mode is desktop/tablet only — isMobile is false */}
                  {renderToolbarExtras(false, appState)}
                </>
              )}
              {isCollaborating && (
                <>
                  <div className="App-toolbar__divider" />
                  <LaserPointerButton
                    title={t("toolBar.laser")}
                    checked={appState.activeTool.type === TOOL_TYPE.laser}
                    onChange={() =>
                      app.setActiveTool({ type: TOOL_TYPE.laser })
                    }
                    isMobile
                  />
                </>
              )}
              {/* Undo/redo live in the collar near the tools — the floating
                bottom-left Footer cluster is not rendered in collar mode. */}
              <UndoRedoActions
                renderAction={actionManager.renderAction}
                className="App-collar-strip__undoredo"
              />
            </div>
          )}
        </Section>
      </div>,
      collarToolbarTarget,
    );
  };

  // Collar shell: element properties as the LEGEND panel, unfolding from the
  // right frame edge (appears on selection — not at-rest chrome). Reuses
  // renderSelectedShapeActions; the collar CSS neutralizes the Island float.
  const renderCollarLegend = () => {
    if (!collarMode || !shouldRenderSelectedShapeActions) {
      return null;
    }
    return (
      <div className="App-collar-legend" data-testid="collar-legend">
        <div className="App-collar-legend__header">LEGEND</div>
        {renderSelectedShapeActions()}
      </div>
    );
  };

  // Collar shell: main-menu trigger in the app's head bar. The dropdown is
  // Radix popper-positioned, so it anchors to the trigger wherever it lives.
  const renderCollarMenu = () => {
    if (!menuInCollar || !collarMenuTarget) {
      return null;
    }
    return createPortal(
      <div className="excalidraw App-collar-host App-collar-menu-host">
        <div style={{ position: "relative" }}>
          <tunnels.MainMenuTunnel.Out />
        </div>
      </div>,
      collarMenuTarget,
    );
  };

  const renderSidebars = () => {
    return (
      <DefaultSidebar
        __fallback
        onDock={(docked) => {
          trackEvent(
            "sidebar",
            `toggleDock (${docked ? "dock" : "undock"})`,
            `(${
              editorInterface.formFactor === "phone" ? "mobile" : "desktop"
            })`,
          );
        }}
      />
    );
  };

  const isSidebarDocked = useAtomValue(isSidebarDockedAtom);

  const layerUIJSX = (
    <>
      {/* ------------------------- tunneled UI ---------------------------- */}
      {/* make sure we render host app components first so that we can detect
          them first on initial render to optimize layout shift */}
      {children}
      {/* render component fallbacks. Can be rendered anywhere as they'll be
          tunneled away. We only render tunneled components that actually
        have defaults when host do not render anything. */}
      <DefaultMainMenu UIOptions={UIOptions} />
      <DefaultSidebar.Trigger
        __fallback
        icon={sidebarRightIcon}
        title={capitalizeString(t("toolBar.library"))}
        onToggle={(open) => {
          if (open) {
            trackEvent(
              "sidebar",
              `${DEFAULT_SIDEBAR.name} (open)`,
              `button (${
                editorInterface.formFactor === "phone" ? "mobile" : "desktop"
              })`,
            );
          }
        }}
        tab={DEFAULT_SIDEBAR.defaultTab}
      />
      <DefaultOverwriteConfirmDialog />
      {appState.openDialog?.name === "ttd" && <TTDDialog __fallback />}
      {/* ------------------------------------------------------------------ */}

      {appState.isLoading && <LoadingMessage delay={250} />}
      {appState.errorMessage && (
        <ErrorDialog onClose={() => setAppState({ errorMessage: null })}>
          {appState.errorMessage}
        </ErrorDialog>
      )}
      {eyeDropperState && editorInterface.formFactor !== "phone" && (
        <EyeDropper
          colorPickerType={eyeDropperState.colorPickerType}
          onCancel={() => {
            setEyeDropperState(null);
          }}
          onChange={(colorPickerType, color, selectedElements, { altKey }) => {
            if (
              colorPickerType !== "elementBackground" &&
              colorPickerType !== "elementStroke"
            ) {
              return;
            }

            if (selectedElements.length) {
              for (const element of selectedElements) {
                mutateElement(element, arrayToMap(elements), {
                  [altKey && eyeDropperState.swapPreviewOnAlt
                    ? colorPickerType === "elementBackground"
                      ? "strokeColor"
                      : "backgroundColor"
                    : colorPickerType === "elementBackground"
                    ? "backgroundColor"
                    : "strokeColor"]: color,
                });
                ShapeCache.delete(element);
              }
              app.scene.triggerUpdate();
            } else if (colorPickerType === "elementBackground") {
              setAppState({
                currentItemBackgroundColor: color,
              });
            } else {
              setAppState({ currentItemStrokeColor: color });
            }
          }}
          onSelect={(color, event) => {
            setEyeDropperState((state) => {
              return state?.keepOpenOnAlt && event.altKey ? state : null;
            });
            eyeDropperState?.onSelect?.(color, event);
          }}
        />
      )}
      {appState.openDialog?.name === "help" && (
        <HelpDialog
          onClose={() => {
            setAppState({ openDialog: null });
          }}
        />
      )}
      <ActiveConfirmDialog />
      {appState.openDialog?.name === "elementLinkSelector" && (
        <ElementLinkDialog
          sourceElementId={appState.openDialog.sourceElementId}
          onClose={() => {
            setAppState({
              openDialog: null,
            });
          }}
          scene={app.scene}
          appState={appState}
          generateLinkForSelection={generateLinkForSelection}
        />
      )}
      <tunnels.OverwriteConfirmDialogTunnel.Out />
      {renderImageExportDialog()}
      {renderJSONExportDialog()}
      {appState.openDialog?.name === "charts" && (
        <PasteChartDialog
          data={appState.openDialog.data}
          rawText={appState.openDialog.rawText}
          onClose={() =>
            setAppState({
              openDialog: null,
            })
          }
        />
      )}
      {editorInterface.formFactor === "phone" && (
        <MobileMenu
          app={app}
          appState={appState}
          elements={elements}
          actionManager={actionManager}
          renderJSONExportDialog={renderJSONExportDialog}
          renderImageExportDialog={renderImageExportDialog}
          setAppState={setAppState}
          onHandToolToggle={onHandToolToggle}
          onPenModeToggle={onPenModeToggle}
          renderTopLeftUI={renderTopLeftUI}
          renderTopRightUI={renderTopRightUI}
          renderSidebars={renderSidebars}
          renderWelcomeScreen={renderWelcomeScreen}
          UIOptions={UIOptions}
        />
      )}
      {editorInterface.formFactor !== "phone" && (
        <>
          {renderCollarToolbar()}
          {renderCollarMenu()}
          <div
            className="layer-ui__wrapper"
            style={
              appState.openSidebar &&
              isSidebarDocked &&
              editorInterface.canFitSidebar
                ? { width: `calc(100% - var(--right-sidebar-width))` }
                : {}
            }
          >
            {renderWelcomeScreen && <tunnels.WelcomeScreenCenterTunnel.Out />}
            {renderFixedSideContainer()}
            {renderCollarLegend()}
            {/* Collar mode: nothing floats at rest — zoom readout lives in
              the app's marginalia, undo/redo in the collar strip (above). */}
            {!collarMode && (
              <Footer
                appState={appState}
                actionManager={actionManager}
                showExitZenModeBtn={showExitZenModeBtn}
                renderWelcomeScreen={renderWelcomeScreen}
              />
            )}
            {(appState.toast || appState.scrolledOutside) && (
              <div className="floating-status-stack">
                {appState.toast && (
                  <Toast
                    message={appState.toast.message}
                    onClose={() => setAppState({ toast: null })}
                    duration={appState.toast.duration}
                    closable={appState.toast.closable}
                  />
                )}
                {!appState.toast && appState.scrolledOutside && (
                  <button
                    type="button"
                    className="scroll-back-to-content"
                    onClick={() => {
                      // Atlasdraw: let the app reframe the map on geo content.
                      // If it handles it (returns true), skip the default
                      // canvas-scroll (which is a no-op under the scroll-lock).
                      if (onScrollBackToContent?.(elements)) {
                        return;
                      }
                      setAppState((appState) => ({
                        ...calculateScrollCenter(elements, appState),
                      }));
                    }}
                  >
                    {t("buttons.scrollBackToContent")}
                  </button>
                )}
              </div>
            )}
          </div>
          {renderSidebars()}
        </>
      )}
    </>
  );

  return (
    <UIAppStateContext.Provider value={appState}>
      <TunnelsJotaiProvider>
        <TunnelsContext.Provider value={tunnels}>
          {layerUIJSX}
        </TunnelsContext.Provider>
      </TunnelsJotaiProvider>
    </UIAppStateContext.Provider>
  );
};

const stripIrrelevantAppStateProps = (appState: AppState): UIAppState => {
  const { cursorButton, scrollX, scrollY, ...ret } = appState;
  return ret;
};

const areEqual = (prevProps: LayerUIProps, nextProps: LayerUIProps) => {
  // short-circuit early
  if (prevProps.children !== nextProps.children) {
    return false;
  }

  const { canvas: _pC, appState: prevAppState, ...prev } = prevProps;
  const { canvas: _nC, appState: nextAppState, ...next } = nextProps;

  return (
    isShallowEqual(
      // asserting AppState because we're being passed the whole AppState
      // but resolve to only the UI-relevant props
      stripIrrelevantAppStateProps(prevAppState as AppState),
      stripIrrelevantAppStateProps(nextAppState as AppState),
      {
        selectedElementIds: isShallowEqual,
        selectedGroupIds: isShallowEqual,
      },
    ) && isShallowEqual(prev, next)
  );
};

export default React.memo(LayerUI, areEqual);
