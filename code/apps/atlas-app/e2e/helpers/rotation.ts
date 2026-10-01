import type { Page } from "@playwright/test";

/**
 * The camera's turn and the first live element's drawing, measured in the
 * browser.
 *
 * - `eastDeg`: the screen angle of geographic east, y-down, straight off real
 *   MapLibre (two points along the centre parallel, projected).
 * - `elAngleDeg`: how far the drawing of the element is turned on screen: the
 *   drawing layer's CSS turn (`--world-rotate`,
 *   docs/architecture/adr/0015-world-coordinates-gate.md) plus the element's
 *   own `angle`.
 * - `cornerErrPx`: for a box, the largest distance between a corner as the
 *   browser draws it (scene → Excalidraw's viewport → the canvas's computed
 *   CSS transform) and `map.project` of that corner's lng/lat (scene → world
 *   frame → lng/lat). Null for an element that is not a box.
 */
export interface TurnMeasure {
  eastDeg: number;
  bearing: number;
  count: number;
  elAngleDeg: number | null;
  cornerErrPx: number | null;
}

export function measureTurn(page: Page): Promise<TurnMeasure> {
  return page.evaluate(() => {
    interface El {
      isDeleted?: boolean;
      x: number;
      y: number;
      width: number;
      height: number;
      angle?: number;
      points?: unknown;
    }
    const a = (
      window as unknown as {
        __atlasdraw__: {
          map: {
            getBearing: () => number;
            getCenter: () => { lng: number; lat: number };
            getContainer: () => HTMLElement;
            project: (lngLat: [number, number]) => { x: number; y: number };
          };
          excalidrawAPI: {
            getSceneElements: () => ReadonlyArray<El>;
            getAppState: () => {
              scrollX: number;
              scrollY: number;
              zoom: { value: number };
            };
          };
          frame: () => unknown;
          toLngLat: (
            frame: unknown,
            p: { x: number; y: number },
          ) => { lng: number; lat: number };
        };
      }
    ).__atlasdraw__;
    const map = a.map;
    const els = a.excalidrawAPI.getSceneElements().filter((e) => !e.isDeleted);

    const c = map.getCenter();
    const pa = map.project([c.lng - 0.02, c.lat]);
    const pb = map.project([c.lng + 0.02, c.lat]);
    const eastDeg = (Math.atan2(pb.y - pa.y, pb.x - pa.x) * 180) / Math.PI;

    const canvas = document.querySelector<HTMLCanvasElement>(
      "canvas.excalidraw__canvas.static",
    )!;
    const style = getComputedStyle(canvas);
    const layerTurnDeg = parseFloat(
      style.getPropertyValue("--world-rotate") || "0",
    );
    const el = els[0];
    let cornerErrPx: number | null = null;
    if (el && !el.points) {
      const { scrollX, scrollY, zoom } = a.excalidrawAPI.getAppState();
      const m = new DOMMatrix(
        style.transform === "none" ? undefined : style.transform,
      );
      const [ox, oy] = style.transformOrigin
        .split(" ")
        .map((v) => parseFloat(v));
      // The canvas and the map container share the plate's top-left.
      const mapRect = map.getContainer().getBoundingClientRect();
      const layerRect = (
        canvas.parentElement as HTMLElement
      ).getBoundingClientRect();
      const offX = layerRect.left - mapRect.left;
      const offY = layerRect.top - mapRect.top;
      const ang = el.angle ?? 0;
      const ecx = el.x + el.width / 2;
      const ecy = el.y + el.height / 2;
      const corner = (dx: number, dy: number) => ({
        x: ecx + dx * Math.cos(ang) - dy * Math.sin(ang),
        y: ecy + dx * Math.sin(ang) + dy * Math.cos(ang),
      });
      const hw = el.width / 2;
      const hh = el.height / 2;
      const scene = [
        corner(-hw, -hh),
        corner(hw, -hh),
        corner(hw, hh),
        corner(-hw, hh),
      ];
      const frame = a.frame();
      const drawn = scene.map((p) => {
        const vx = (p.x + scrollX) * zoom.value - ox;
        const vy = (p.y + scrollY) * zoom.value - oy;
        return {
          x: ox + m.a * vx + m.c * vy + m.e + offX,
          y: oy + m.b * vx + m.d * vy + m.f + offY,
        };
      });
      const truth = scene.map((p) => {
        const ll = a.toLngLat(frame, p);
        return map.project([ll.lng, ll.lat]);
      });
      cornerErrPx = Math.max(
        ...drawn.map((d, i) =>
          Math.hypot(d.x - truth[i]!.x, d.y - truth[i]!.y),
        ),
      );
    }
    return {
      eastDeg,
      bearing: map.getBearing(),
      count: els.length,
      elAngleDeg: el ? layerTurnDeg + ((el.angle ?? 0) * 180) / Math.PI : null,
      cornerErrPx,
    };
  });
}
