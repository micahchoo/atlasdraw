// Atlasdraw addition (docs/architecture/adr/0015-world-coordinates-gate.md).
// The atlas adapter of the fork's creation seam, `stampNewElements`. How an
// element came in decides what happens to it; a missing unit decides nothing.

import { pointFrom } from "@atlasdraw/math";

import type { LocalPoint } from "@atlasdraw/math";

import { atlasStampNewElements } from "../src/atlasStamp";
import { newArrowElement, newElement, newTextElement } from "../src/newElement";

import type { ExcalidrawElement } from "../src/types";

const ZOOM = 1 / 1024;
const VIEW = { zoom: ZOOM };

const unitOf = (el: ExcalidrawElement) =>
  (el.customData as { atlas?: { unit?: number } } | undefined)?.atlas?.unit;

const rect = (
  props: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    strokeWidth?: number;
    customData?: Record<string, any>;
  } = {},
) =>
  newElement({
    type: "rectangle",
    x: 10,
    y: 20,
    width: 100,
    height: 50,
    strokeWidth: 2,
    ...props,
  });

describe("atlasStampNewElements", () => {
  it.each(["draw", "text", "insert-image"] as const)(
    "%s: records the unit of the zoom and moves nothing",
    (how) => {
      const el = rect({ x: 10 * 1024, width: 100 * 1024 });
      const [out] = atlasStampNewElements([el], how, VIEW);
      expect(unitOf(out)).toBe(1024);
      expect([out.x, out.y, out.width, out.height]).toEqual([
        el.x,
        el.y,
        el.width,
        el.height,
      ]);
    },
  );

  it("keeps the other customData fields", () => {
    const el = rect({ customData: { atlas: { hidden: true }, note: 1 } });
    const [out] = atlasStampNewElements([el], "draw", VIEW);
    expect(out.customData).toEqual({
      atlas: { hidden: true, unit: 1024 },
      note: 1,
    });
  });

  it.each(["paste", "duplicate"] as const)(
    "%s: an atlas copy keeps its size and its unit",
    (how) => {
      const el = rect({ customData: { atlas: { unit: 64 } } });
      const [out] = atlasStampNewElements([el], how, VIEW);
      expect(out).toEqual(el);
    },
  );

  it("paste: text without a unit is the atlas's own, not foreign", () => {
    // Text made before every creation path recorded a unit. Its size is a
    // world size already, so it keeps it and takes the unit of its batch.
    const box = rect({ customData: { atlas: { unit: 64 } } });
    const label = newTextElement({
      text: "Ward 3",
      x: 0,
      y: 0,
      fontSize: 1280,
    });
    const [, out] = atlasStampNewElements([box, label], "paste", VIEW);
    expect((out as typeof label).fontSize).toBe(1280);
    expect(unitOf(out)).toBe(64);
  });

  it.each(["import", "library"] as const)(
    "%s: content made for scene = screen comes in at its screen size",
    (how) => {
      const el = rect({ x: 10, y: 20, width: 100, height: 50 });
      const other = rect({ x: 210, y: 20, width: 100, height: 50 });
      const [a, b] = atlasStampNewElements([el, other], how, VIEW);
      expect([a.width, a.height, a.strokeWidth]).toEqual([
        100 * 1024,
        50 * 1024,
        2 * 1024,
      ]);
      // The gap between them scales too.
      expect(b.x - a.x).toBe(200 * 1024);
      expect(unitOf(a)).toBe(1024);
      expect(unitOf(b)).toBe(1024);
    },
  );

  it("library: an item made in the atlas at another zoom comes in at the screen size it had", () => {
    // Drawn at unit 64 (100 px wide there); inserted at unit 1024.
    const el = rect({
      width: 6400,
      strokeWidth: 128,
      customData: { atlas: { unit: 64 } },
    });
    const [out] = atlasStampNewElements([el], "library", VIEW);
    expect(out.width).toBe(100 * 1024);
    expect(out.strokeWidth).toBe(2 * 1024);
    expect(unitOf(out)).toBe(1024);
  });

  it("import: scales points, font size and elbow segments", () => {
    const arrow = newArrowElement({
      type: "arrow",
      x: 0,
      y: 0,
      points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(-40, 30)],
      elbowed: true,
      fixedSegments: [
        {
          index: 1,
          start: pointFrom<LocalPoint>(0, 10),
          end: pointFrom<LocalPoint>(-40, 10),
        },
      ],
    });
    const text = newTextElement({ text: "a", x: 0, y: 0, fontSize: 20 });
    const [a, t] = atlasStampNewElements([arrow, text], "import", VIEW) as [
      typeof arrow,
      typeof text,
    ];
    expect(a.points[1]).toEqual([-40 * 1024, 30 * 1024]);
    expect(a.fixedSegments![0].start).toEqual([0, 10 * 1024]);
    expect(a.fixedSegments![0].end).toEqual([-40 * 1024, 10 * 1024]);
    expect(t.fontSize).toBe(20 * 1024);
  });
});
