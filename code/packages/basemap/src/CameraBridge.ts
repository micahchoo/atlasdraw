// SPDX-License-Identifier: MIT
//
// The camera bridge (docs/architecture/adr/0015-world-coordinates-gate.md).
//
// The map owns the camera. On every map `move` the bridge writes Excalidraw's
// scrollX / scrollY / zoom from it and writes no element. When Excalidraw moves
// its own viewport (space-drag, zoom actions, scroll-to-content), the change
// arrives through the `onScrollChange` prop and goes back to `map.jumpTo` once.
//
// Loop suppression: the bridge remembers the viewport it last
// wrote. A scroll change near it is the echo of its own write and is
// dropped; any other value is Excalidraw's own and is forwarded. `jumpTo`
// fires `move` synchronously, which writes the map's answer back — that write
// echoes, is dropped, and the exchange ends.
//
// "Near", not equal: Excalidraw can hand back a value it changed a little.
// getNormalizedZoom rounds the zoom to 6 decimals, about 5e-6 of a zoom value
// of 0.1, and float arithmetic changes a scroll by far less than a pixel. An
// exact test took such an echo for a move, jumped the map, and could loop.
//
// A container resize: MapLibre's resize() fires `move`, and the caller also
// pushes after a resize, because it caches the size (useCameraBridge.ts).

import { cameraFor, viewportFor } from "@atlasdraw/geo";

import type { SceneViewport, WorldFrame } from "@atlasdraw/geo";

export interface BridgeMap {
  getCenter(): { lng: number; lat: number };
  getZoom(): number;
  jumpTo(options: { center: { lng: number; lat: number }; zoom: number }): void;
  on(type: "move", listener: () => void): void;
  off(type: "move", listener: () => void): void;
}

export interface BridgeScene {
  updateScene(data: {
    appState: { scrollX: number; scrollY: number; zoom: { value: number } };
  }): void;
}

export interface CameraBridgeStats {
  /** Viewport writes into Excalidraw. */
  mapToScene: number;
  /** `jumpTo` calls made for Excalidraw-originated viewport changes. */
  sceneToMap: number;
  /** Scroll changes recognised as the echo of the bridge's own write. */
  suppressed: number;
}

/** A zoom within this part of the written one is the echo. */
const ECHO_ZOOM = 1e-5;
/** A scroll within this many screen pixels of the written one is the echo. */
const ECHO_PIXELS = 1e-3;

/** True when the reported viewport is the bridge's own write, `w`. */
export const isEcho = (
  w: SceneViewport,
  scrollX: number,
  scrollY: number,
  zoom: number,
): boolean =>
  Math.abs(zoom - w.zoom) <= ECHO_ZOOM * w.zoom &&
  Math.abs(scrollX - w.scrollX) * w.zoom <= ECHO_PIXELS &&
  Math.abs(scrollY - w.scrollY) * w.zoom <= ECHO_PIXELS;

export class CameraBridge {
  private readonly getFrame: () => WorldFrame;
  private readonly map: BridgeMap;
  private readonly scene: BridgeScene;
  private attached = false;
  private readonly viewportSize: () => { width: number; height: number };
  private written: SceneViewport | null = null;
  stats: CameraBridgeStats = { mapToScene: 0, sceneToMap: 0, suppressed: 0 };

  /**
   * `viewportSize` is the MAP's size. The drawing layer and the map share a
   * top-left corner but not a width — the sheet panel narrows only the map —
   * so the camera centre lands at the map's centre in both.
   *
   * `frame` is read on every exchange: opening a document changes it, and the
   * next camera event must already use the new one.
   */
  constructor(opts: {
    map: BridgeMap;
    scene: BridgeScene;
    frame: WorldFrame | (() => WorldFrame);
    viewportSize: () => { width: number; height: number };
  }) {
    this.map = opts.map;
    this.scene = opts.scene;
    const frame = opts.frame;
    this.getFrame = typeof frame === "function" ? frame : () => frame;
    this.viewportSize = opts.viewportSize;
  }

  /** The world frame the bridge maps with now. */
  get frame(): WorldFrame {
    return this.getFrame();
  }

  attach(): void {
    if (this.attached) {
      return;
    }
    this.attached = true;
    this.map.on("move", this.push);
    this.push();
  }

  detach(): void {
    this.attached = false;
    this.map.off("move", this.push);
  }

  resetStats(): void {
    this.stats = { mapToScene: 0, sceneToMap: 0, suppressed: 0 };
  }

  /** Map → scene. Arrow function: it is the `move` listener's identity. */
  readonly push = (): void => {
    if (!this.attached) {
      return;
    }
    const { width, height } = this.viewportSize();
    const v = viewportFor(this.getFrame(), {
      center: this.map.getCenter(),
      zoom: this.map.getZoom(),
      width,
      height,
    });
    this.written = v;
    this.stats.mapToScene++;
    this.scene.updateScene({
      appState: {
        scrollX: v.scrollX,
        scrollY: v.scrollY,
        zoom: { value: v.zoom },
      },
    });
  };

  /** Scene → map: Excalidraw's `onScrollChange` prop. */
  readonly onScrollChange = (
    scrollX: number,
    scrollY: number,
    zoom: { readonly value: number },
  ): void => {
    if (!this.attached) {
      return;
    }
    const w = this.written;
    if (w && isEcho(w, scrollX, scrollY, zoom.value)) {
      this.stats.suppressed++;
      return;
    }
    const { width, height } = this.viewportSize();
    this.stats.sceneToMap++;
    // Record what Excalidraw holds now, so a `move` that changes nothing
    // (MapLibre clamps a centre or zoom) cannot bounce the same value back.
    this.written = { scrollX, scrollY, zoom: zoom.value };
    this.map.jumpTo(
      cameraFor(this.getFrame(), {
        scrollX,
        scrollY,
        zoom: zoom.value,
        width,
        height,
      }),
    );
  };
}
