// SPDX-License-Identifier: MIT
// ADR-0015 spike — the camera bridge.
//
// The map owns the camera. On every map `move` the bridge writes Excalidraw's
// scrollX / scrollY / zoom from it and writes no element. When Excalidraw moves
// its own viewport (space-drag, zoom actions, scroll-to-content), the change
// arrives through the `onScrollChange` prop and goes back to `map.jumpTo` once.
//
// Loop suppression (audit R1): the bridge remembers the viewport it last
// wrote. A scroll change equal to it is the echo of its own write and is
// dropped; any other value is Excalidraw's own and is forwarded. `jumpTo`
// fires `move` synchronously, which writes the map's answer back — that write
// echoes, is dropped, and the exchange ends.
//
// A container resize needs nothing extra: MapLibre's resize() fires `move`.

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

export class CameraBridge {
  readonly frame: WorldFrame;
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
   */
  constructor(opts: {
    map: BridgeMap;
    scene: BridgeScene;
    frame: WorldFrame;
    viewportSize: () => { width: number; height: number };
  }) {
    this.map = opts.map;
    this.scene = opts.scene;
    this.frame = opts.frame;
    this.viewportSize = opts.viewportSize;
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
    const v = viewportFor(this.frame, {
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
    if (
      w &&
      w.scrollX === scrollX &&
      w.scrollY === scrollY &&
      w.zoom === zoom.value
    ) {
      this.stats.suppressed++;
      return;
    }
    const { width, height } = this.viewportSize();
    this.stats.sceneToMap++;
    // Record what Excalidraw holds now, so a `move` that changes nothing
    // (MapLibre clamps a centre or zoom) cannot bounce the same value back.
    this.written = { scrollX, scrollY, zoom: zoom.value };
    this.map.jumpTo(
      cameraFor(this.frame, {
        scrollX,
        scrollY,
        zoom: zoom.value,
        width,
        height,
      }),
    );
  };
}
