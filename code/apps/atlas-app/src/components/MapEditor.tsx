/**
 * MapEditor — the editor: MapLibre GL (bottom) and a transparent Excalidraw
 * (top) stacked in one container, inside the collar.
 *
 * It creates the editor's EditorSession and provides it to every view, and
 * it lays the views out. What the editor does lives in the session's modules,
 * the commands (commands/commands.ts) and the hooks it wires here.
 *
 * Who takes the pointer: every Excalidraw tool except the hand tool captures
 * pointer events (classifyTool), so a drag with the
 * selection tool selects. The hand tool lets the pointer through to the map,
 * and Space+drag pans with any tool. Wheel and pinch always go to the map
 * (useMapWheelRouter).
 *
 * The map owns the camera; Excalidraw's scroll and zoom follow it
 * (useCameraBridge, docs/architecture/adr/0015-world-coordinates-gate.md).
 * A drawn element is stored in world
 * coordinates, so no camera move rewrites it.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useStore } from "zustand";

import { MapCanvas } from "@atlasdraw/basemap";
import { atlasStampNewElements } from "@atlasdraw/element";
import { Excalidraw } from "@atlasdraw/excalidraw";

import type { MapCanvasInitialView } from "@atlasdraw/basemap";
import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw";

import { commandById } from "../commands/commands";
import { useCommandMenus } from "../commands/contextMenus";
import { useCommandKeys } from "../commands/useCommandKeys";
import { getAppConfig } from "../config/app-config";
import { useAtlasdrawTool } from "../hooks/useAtlasdrawTool";
import { useBasemapStyle } from "../hooks/useBasemapStyle";
import { useBrowserTabTitle } from "../hooks/useBrowserTabTitle";
import { useCameraBridge } from "../hooks/useCameraBridge";
import { useCameraRotation } from "../hooks/useCameraRotation";
import { useCommentModeTool } from "../hooks/useCommentModeTool";
import { useCommentSearchSources } from "../hooks/useCommentSearchSources";
import { useDevHandles } from "../hooks/useDevHandles";
import { useEditorHistory } from "../hooks/useEditorHistory";
import { useExcalidrawChangeHandler } from "../hooks/useExcalidrawChangeHandler";
import { useMapOverlays } from "../hooks/useMapOverlays";
import { useMapRef } from "../hooks/useMapRef";
import { useMapSelect } from "../hooks/useMapSelect";
import { useMapWheelRouter } from "../hooks/useMapWheelRouter";
import { useOpenThreadCountFor } from "../hooks/useOpenThreadCount";
import { usePersistenceWiring } from "../hooks/usePersistenceWiring";
import { roomConnection, roomProblem, useRoom } from "../hooks/useRoom";
import { useSelectionSync } from "../hooks/useSelectionSync";
import { useServerBackup } from "../hooks/useServerBackup";
import { useSessionImport } from "../hooks/useSessionImport";
import { useToolState } from "../hooks/useToolState";
import { LayersIcon } from "../lib/icons";
import { createSession } from "../session/EditorSession";
import { historyHost } from "../session/history";
import { SessionProvider } from "../session/SessionContext";
import { openSceneFile } from "../session/fileActions";
import { useDocument, useDocumentStore } from "../state/document";
import { configuredTransport, isRoomDocument } from "../state/room";
import { editorScene, useSceneBinding } from "../state/scene";
import styles from "../styles/MapEditor.module.css";

import { useAnnounce } from "./AriaAnnouncer";
import { CollarShell } from "./CollarShell";
import { CommentAnchorsOverlay } from "./CommentAnchorsOverlay";
import { CommentModeButton } from "./CommentModeButton";
import { CursorOverlay } from "./CursorOverlay";
import { EditorDialogs } from "./EditorDialogs";
import { EditorMenu } from "./EditorMenu";
import { FeaturePopup } from "./FeaturePopup";
import { GeoSearchControl } from "./GeoSearchControl";
import { LayerPanel } from "./LayerPanel";
import { MapCompass } from "./MapCompass";
import { MeasureLayer } from "./MeasureLayer";
import { MeasureToolButton } from "./MeasureToolButton";
import { shouldShowOnboarding } from "./OnboardingTips";
import { PinToolButton } from "./PinToolButton";
import { PresenceList } from "./PresenceList";
import { SheetNameField } from "./SheetNameField";
import { SheetPanelResizer } from "./SheetPanelResizer";
import { SheetRail } from "./SheetRail";
import { StatusBar } from "./StatusBar";
import { useToast } from "./ToastProvider";
import { ToolOptionsBar } from "./ToolOptionsBar";

import type { SharedMap } from "../routes";

// Module-scoped so the Excalidraw mount sees a stable identity: it reads
// initialData once.
const EXCALIDRAW_INITIAL_DATA = {
  appState: {
    viewBackgroundColor: "transparent",
    // The sheet panel is the plate's right margin, not a floating overlay:
    // docked is the only state in which the editor reserves a column for it,
    // so the map reflows instead of being covered. A preference, so a user
    // who undocks keeps that choice.
    defaultSidebarDockedPreference: true,
  },
} as const;

// The .atlasdraw file is the one way to save and open (session/
// fileActions.ts). These close Excalidraw's own load, save, export and help,
// with their keys and palette entries. Tested in the fork:
// packages/excalidraw/tests/closedExportDoors.test.tsx and
// closedHelpDoor.test.tsx. `clearCanvas` is closed because the editor's
// "Clear the drawing" keeps the layers and the canvas colour.
const EXCALIDRAW_UI_OPTIONS = {
  canvasActions: {
    loadScene: false,
    saveToActiveFile: false,
    export: false as const,
    saveAsImage: false,
    toggleShortcuts: false,
    clearCanvas: false,
  },
} as const;

type SheetPanelLayout = { open: boolean; shrunk: boolean; collar: boolean };

export interface MapEditorProps {
  /** Initial map viewport; changes after mount are ignored. */
  initialView?: MapCanvasInitialView;
  /** A shared map to open as a copy when the editor starts (routes.ts). */
  open?: SharedMap | null;
}

export function MapEditor({ initialView, open }: MapEditorProps) {
  const toast = useToast();
  const [session] = useState(() =>
    createSession({
      store: useDocumentStore,
      scene: editorScene,
      transport: configuredTransport(),
      notify: { success: toast.success, error: toast.error },
    }),
  );
  const { view } = session;
  const onSceneFileDrop = useCallback(
    (file: File) => void openSceneFile(session, file),
    [session],
  );
  const { map, onMapReady } = useMapRef();
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  useEffect(() => {
    view.getState().setMap(map);
    view.getState().setApi(api);
  }, [view, map, api]);
  useEffect(() => () => view.setState({ map: null, api: null }), [view]);

  const rootRef = useRef<HTMLDivElement>(null);
  // State, not refs: Excalidraw renders its toolbar and menu trigger into
  // these collar hosts, and must render again once they mount.
  const [toolStripHost, setToolStripHost] = useState<HTMLDivElement | null>(
    null,
  );
  const [menuHost, setMenuHost] = useState<HTMLDivElement | null>(null);
  const [drawingLayer, setDrawingLayer] = useState<HTMLDivElement | null>(null);

  // The sheet panel's width is the session's; whether the plate gives up a
  // column for it comes back from the editor's own `isUIShrunkForSidebar`,
  // the expression that also narrows the UI and moves the collar legend.
  const sheetPanelWidth = useStore(view, (s) => s.sheetPanelWidth);
  const [panel, setPanel] = useState<SheetPanelLayout>({
    open: false,
    shrunk: false,
    collar: false,
  });
  // Stable: <Excalidraw> is memoized on a shallow prop compare.
  const onSidebarLayoutChange = useCallback(
    (next: SheetPanelLayout) =>
      setPanel((prev) =>
        prev.open === next.open &&
        prev.shrunk === next.shrunk &&
        prev.collar === next.collar
          ? prev
          : next,
      ),
    [],
  );

  const { bridge, onZoomAction } = useCameraBridge(map, api, drawingLayer);
  const room = useRoom(api, map, session);
  useEffect(() => {
    if (room.status === "joined") {
      toast.success(
        "You are in a shared map. Your own map stays saved and unchanged.",
      );
    }
  }, [room.status, toast]);

  useBrowserTabTitle();
  useSelectionSync(view, api);
  const popup = useMapSelect(session, map, api);
  const basemap = useDocument((s) => s.basemap);
  useBasemapStyle(map, basemap, getAppConfig().allowRemoteBasemaps);
  useDevHandles(session, map, api, bridge);
  useEditorHistory(session, api);
  // Stable: <Excalidraw> is memoized on a shallow prop compare.
  const drawingHistoryHost = useMemo(
    () => historyHost(session.history),
    [session],
  );
  usePersistenceWiring(session, api, session.notify, open);
  useSceneBinding(api);
  useMapWheelRouter(rootRef.current, map);
  // The only writer of the overlay part of the map style.
  useMapOverlays(map);
  useServerBackup(session);
  useSessionImport(session, rootRef, api, panel.open);
  useCommandMenus(session, api);
  useCommandKeys(session);

  // Drawing is off while the camera is turned. Unprojecting the corners of a
  // rectangle dragged at 30° gives a north-aligned box that is not the box
  // the user dragged, so the plate refuses the drag and the hint below
  // offers the way back. Blocked, the drag reaches MapLibre, so a turned
  // plate still pans and zooms. A pin is a point, exact at any rotation, so
  // the atlas tools stay on.
  const { isDrawingMode: toolWantsToDraw } = useToolState(api);
  const rotation = useCameraRotation(map);
  const drawingBlocked = rotation.isRotated;
  const isDrawingMode = toolWantsToDraw && !drawingBlocked;

  const { activeAtlasTool, setActiveAtlasTool, dispatchPointerDown } =
    useAtlasdrawTool(view, map, api);
  const commentMode = useStore(view, (s) => s.commentMode);
  useCommentModeTool({
    view,
    atlasTool: activeAtlasTool,
    setAtlasTool: setActiveAtlasTool,
  });
  const comments = useDocumentStore((s) => s.doc.comments);
  const openThreadCount = useOpenThreadCountFor(comments);
  // Memoized in the hook: an unstable array would render the editor again.
  const searchSources = useCommentSearchSources({
    commentsLayer: comments,
    map,
    excalidrawAPI: api,
  });
  // A room's map is the relay's to keep (ADR-0018): its edits are never
  // "unsaved" here.
  const unsaved = useSyncExternalStore(
    session.history.subscribe,
    () => session.history.dirty,
  );
  const inRoom = useDocumentStore((s) => isRoomDocument(s.doc));
  const isDirty = unsaved && !inRoom;
  // Another tab holds the open map (session/mapOwnership.ts).
  const readOnly = useStore(session.persistence, (s) => s.readOnly);
  // The first-run tour is a dialog in the slot: the commands wait for it.
  useEffect(() => {
    if (shouldShowOnboarding()) {
      view.getState().openDialog({ kind: "onboarding" });
    }
  }, [view]);
  const announce = useAnnounce();
  const onDrawingChange = useExcalidrawChangeHandler({
    excalidrawAPI: api,
    announceMapEditor: announce,
    setMapBg: useCallback(
      (color: string) => view.setState({ mapBackground: color }),
      [view],
    ),
    view,
  });
  const mapBackground = useStore(view, (s) => s.mapBackground);

  // The Layers panel is a tab of Excalidraw's sidebar. It renders inside
  // <Excalidraw>, so it reads the session from the provider below.
  useEffect(
    () =>
      api?.registerSidebarTab({
        name: "layers",
        label: "Layers",
        icon: <LayersIcon />,
        content: <LayerPanel />,
      }),
    [api],
  );

  const problem = roomProblem(room);

  return (
    <SessionProvider session={session}>
      <CollarShell
        map={map}
        sheetName={<SheetNameField />}
        headExtras={<GeoSearchControl map={map} variant="collar" />}
        toolStripHostRef={setToolStripHost}
        menuHostRef={setMenuHost}
        tabs={<SheetRail excalidrawAPI={api} />}
        panelInset={panel.shrunk ? sheetPanelWidth : 0}
        foot={<StatusBar map={map} dirty={isDirty} />}
      >
        <div
          ref={rootRef}
          className={[styles.root, commentMode ? styles.commentMode : ""]
            .filter(Boolean)
            .join(" ")}
          style={{ backgroundColor: mapBackground }}
          data-testid="map-editor-root"
          data-comment-mode={commentMode ? "on" : undefined}
          // The drawing gate as state a test can read.
          data-drawing-blocked={drawingBlocked ? "true" : undefined}
        >
          <div className={styles.mapLayer}>
            <MapCanvas
              initialView={initialView}
              onMapReady={onMapReady}
              className={styles.fullSize}
              // The collar's foot prints the attribution.
              hideAttribution
              // The editor ships a compass, so it is the one view that turns.
              allowRotation
            />
          </div>

          {/* pointer-events: none until a drawing tool is active. */}
          <div
            ref={setDrawingLayer}
            className={[
              styles.excalidrawLayer,
              isDrawingMode ? styles.excalidrawLayerActive : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <Excalidraw
              initialData={EXCALIDRAW_INITIAL_DATA}
              gridModeEnabled={false}
              viewModeEnabled={readOnly}
              // Zen mode hides the drawing's panels into the map and has no
              // way back over it; the prop also turns its key off. The canvas
              // menu keeps only the settings that work over a map, as
              // commands (.claude/rules/menus.md).
              zenModeEnabled={false}
              canvasMenuToggles={false}
              onExcalidrawAPI={setApi}
              onChange={onDrawingChange}
              onScrollChange={bridge?.onScrollChange}
              onZoomAction={onZoomAction}
              // A dropped .excalidraw file (or an image that carries one)
              // opens as Open does, never into the open map.
              onSceneFileDrop={onSceneFileDrop}
              screenSizedStyles
              // Every new element records its unit; foreign content comes
              // in at its screen size (element/src/atlasStamp.ts).
              stampNewElements={atlasStampNewElements}
              // The keyboard half of the drawing gate: paste and nudge use
              // Excalidraw's unturned screen math.
              placementBlocked={drawingBlocked}
              // One history over the document and the drawing: the undo
              // and redo keys and buttons go to it (session/history.ts).
              historyHost={drawingHistoryHost}
              // Its fixed gaps and unitless arrows do not fit world
              // coordinates (packages/excalidraw/tests/flowchartOff.test.tsx).
              flowchart={false}
              UIOptions={EXCALIDRAW_UI_OPTIONS}
              collarToolbarTarget={toolStripHost}
              collarMenuTarget={menuHost}
              searchSources={searchSources}
              // SheetRail is the sidebar's one trigger surface.
              hideDefaultSidebarTabTriggers
              rightSidebarWidth={sheetPanelWidth}
              onSidebarLayoutChange={onSidebarLayoutChange}
              renderToolbarExtras={() => (
                <>
                  <PinToolButton
                    active={activeAtlasTool?.id === "pin"}
                    onToggle={() => commandById("tools.pin")!.run(session)}
                  />
                  <MeasureToolButton />
                  <CommentModeButton
                    active={commentMode}
                    onToggle={view.getState().toggleCommentMode}
                    openThreadCount={openThreadCount}
                  />
                </>
              )}
            >
              <EditorMenu />
            </Excalidraw>
          </div>

          <FeaturePopup popup={popup.popup} onClose={popup.close} />
          <CommentAnchorsOverlay map={map} excalidrawAPI={api} />
          {/* Always mounted: it is the one mouse gesture that turns the map. */}
          <MapCompass map={map} rotation={rotation} />

          {drawingBlocked && toolWantsToDraw && (
            <div
              className={styles.drawBlockedHint}
              role="status"
              data-testid="draw-blocked-hint"
            >
              Drawing is off while the map is turned
              <button
                type="button"
                className={styles.drawBlockedReset}
                onClick={() => map?.resetNorth()}
              >
                Reset north
              </button>
            </div>
          )}

          {commentMode && (
            <div
              className={styles.commentModeHint}
              role="status"
              data-testid="comment-mode-hint"
            >
              Click the map or an element to start a thread
              <span className={styles.commentModeHintKey}>Esc</span>
              to exit
            </div>
          )}

          {room.room && (
            <>
              <CursorOverlay map={map} peers={room.peers} />
              <PresenceList
                peers={room.peers}
                self={room.self}
                onRename={room.rename}
                connection={roomConnection(room)}
                onGoTo={(camera) =>
                  map?.jumpTo({
                    center: camera.center,
                    zoom: camera.zoom,
                    bearing: camera.bearing,
                    pitch: camera.pitch,
                  })
                }
              />
            </>
          )}

          {/* The handle sits at the panel's edge, which exists only while the
          panel is open, and only under the collar: on a phone the sidebar
          takes another width and the handle would float over the map. */}
          {panel.open && panel.collar && (
            <SheetPanelResizer
              width={sheetPanelWidth}
              onWidth={view.getState().setSheetPanelWidth}
              onReset={view.getState().resetSheetPanelWidth}
            />
          )}

          {/* Above the drawing while an atlas tool is active: the click goes
          to the tool, not to Excalidraw's selection. */}
          {activeAtlasTool && (
            <>
              <div
                className={styles.atlasToolOverlay}
                data-testid="atlas-tool-overlay"
                onPointerDown={(e) =>
                  dispatchPointerDown({
                    clientX: e.clientX,
                    clientY: e.clientY,
                    pointerId: e.pointerId,
                    pointerType:
                      (e.pointerType as "mouse" | "pen" | "touch") ?? "mouse",
                    button: e.button,
                    shiftKey: e.shiftKey,
                    altKey: e.altKey,
                    ctrlKey: e.ctrlKey,
                    metaKey: e.metaKey,
                  })
                }
                style={{ cursor: activeAtlasTool.cursor }}
              />
              <ToolOptionsBar label={activeAtlasTool.label} showEscapeHint />
            </>
          )}

          <MeasureLayer
            map={map}
            excalidrawAPI={api}
            otherToolActive={activeAtlasTool !== null || commentMode}
            onStart={() => setActiveAtlasTool(null)}
          />

          <EditorDialogs startRoom={room.available ? room.start : null} />

          {problem && (
            <div
              data-testid="collab-room-error"
              role="alert"
              className={styles.collabRoomError}
            >
              {problem}
            </div>
          )}
        </div>
      </CollarShell>
    </SessionProvider>
  );
}
