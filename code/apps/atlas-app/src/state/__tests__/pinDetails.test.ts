// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
//
// Pin details: what a pin may carry (title, description, link, photo), the
// one reading of them that every path shares, and the gate's repair of a
// pin from a stranger.

import { describe, expect, it } from "vitest";

import { documentFrame, sceneUnitsPerPixel, toScene } from "@atlasdraw/geo";

import type { ExcalidrawElement } from "@atlasdraw/element/types";

import {
  PIN_LIMITS,
  elementFileIds,
  pinAt,
  readPinDetails,
  safeLink,
  withPinDetails,
} from "../pinDetails";
import { checkElement } from "../roomValidation";

// The links an attacker writes. The rule against script URLs is for code
// that follows them; these are refused.
// eslint-disable-next-line no-script-url
const SCRIPT_LINK = "javascript:alert(1)";

describe("safeLink", () => {
  it("keeps an http or https address", () => {
    expect(safeLink("https://example.org/a?b=1")).toBe(
      "https://example.org/a?b=1",
    );
    expect(safeLink("  http://example.org  ")).toBe("http://example.org/");
  });

  it.each([
    SCRIPT_LINK,
    SCRIPT_LINK.toUpperCase(),
    "data:text/html,<script>alert(1)</script>",
    "vbscript:x",
    "/relative/path",
    "//example.org",
    "ftp://example.org",
    "",
  ])("refuses %j", (text) => {
    expect(safeLink(text)).toBeNull();
  });

  it("refuses an address over the cap", () => {
    expect(
      safeLink(`https://example.org/${"a".repeat(PIN_LIMITS.link)}`),
    ).toBeNull();
  });
});

describe("readPinDetails", () => {
  it("reads the four fields", () => {
    expect(
      readPinDetails({
        pin: {
          title: "Well",
          description: "Dug 1902.\nStill used.",
          link: "https://example.org/well",
          photo: "file-1",
        },
      }),
    ).toEqual({
      title: "Well",
      description: "Dug 1902.\nStill used.",
      link: "https://example.org/well",
      photo: "file-1",
    });
  });

  it("drops each field that is wrong, and keeps the rest", () => {
    expect(
      readPinDetails({
        pin: {
          title: "x".repeat(PIN_LIMITS.title + 1),
          description: 5,
          link: SCRIPT_LINK,
          photo: "",
          extra: "<img onerror=alert(1)>",
        },
      }),
    ).toEqual({});
    expect(readPinDetails({ pin: { title: "Ok", link: "nope" } })).toEqual({
      title: "Ok",
    });
  });

  it("is empty for no customData, no pin, or a pin that is not an object", () => {
    expect(readPinDetails(undefined)).toEqual({});
    expect(readPinDetails({})).toEqual({});
    expect(readPinDetails({ pin: "Well" })).toEqual({});
    expect(readPinDetails({ pin: ["Well"] })).toEqual({});
  });
});

describe("withPinDetails", () => {
  it("writes the fields that are set and keeps the other customData", () => {
    const customData = { tool: "pin", atlas: { unit: 2 }, _data: { a: 1 } };
    expect(
      withPinDetails(customData, { title: "Well", description: "" }),
    ).toEqual({ ...customData, pin: { title: "Well" } });
  });

  it("removes the record when no field is set", () => {
    expect(
      withPinDetails({ tool: "pin", pin: { title: "Well" } }, { title: " " }),
    ).toEqual({ tool: "pin" });
  });
});

const frame = documentFrame(13.4, 52.5);

/** A pin as seedToElement makes it: 16 px at zoom `z`, centred on lng/lat. */
function pin(
  id: string,
  lng: number,
  lat: number,
  z: number,
  extra: Record<string, unknown> = {},
): ExcalidrawElement {
  const d = 16 * sceneUnitsPerPixel(frame, z);
  const c = toScene(frame, lng, lat);
  return {
    id,
    type: "ellipse",
    x: c.x - d / 2,
    y: c.y - d / 2,
    width: d,
    height: d,
    isDeleted: false,
    customData: { tool: "pin", ...extra },
  } as unknown as ExcalidrawElement;
}

describe("pinAt", () => {
  const a = pin("a", 13.4, 52.5, 12);
  const b = pin("b", 13.4, 52.5, 12);
  const ellipse = { ...pin("c", 13.5, 52.5, 12), customData: {} };

  it("finds the topmost pin under the point", () => {
    expect(pinAt([a, b], frame, { lng: 13.4, lat: 52.5 }, 12)?.id).toBe("b");
  });

  it("finds nothing beside a pin, and never a plain ellipse", () => {
    expect(pinAt([a], frame, { lng: 13.45, lat: 52.5 }, 12)).toBeNull();
    expect(
      pinAt(
        [ellipse as ExcalidrawElement],
        frame,
        { lng: 13.5, lat: 52.5 },
        12,
      ),
    ).toBeNull();
  });

  it("skips a deleted pin", () => {
    const gone = { ...a, isDeleted: true } as ExcalidrawElement;
    expect(pinAt([gone], frame, { lng: 13.4, lat: 52.5 }, 12)).toBeNull();
  });
});

describe("elementFileIds", () => {
  it("names an image's file and a pin's photo", () => {
    expect(
      elementFileIds({
        type: "image",
        fileId: "img",
        isDeleted: false,
      } as unknown as ExcalidrawElement),
    ).toEqual(["img"]);
    expect(
      elementFileIds(pin("p", 0, 0, 3, { pin: { photo: "photo" } })),
    ).toEqual(["photo"]);
  });

  it("names nothing for a deleted element", () => {
    expect(
      elementFileIds({
        ...pin("p", 0, 0, 3, { pin: { photo: "photo" } }),
        isDeleted: true,
      } as ExcalidrawElement),
    ).toEqual([]);
  });
});

describe("the gate repairs a pin from a stranger", () => {
  const record = (pinRecord: unknown) => ({
    id: "p1",
    type: "ellipse",
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    version: 1,
    versionNonce: 1,
    isDeleted: false,
    customData: { tool: "pin", pin: pinRecord },
  });

  it("drops a script link and keeps the title", () => {
    const el = checkElement("p1", record({ title: "Well", link: SCRIPT_LINK }));
    expect(el?.customData).toEqual({ tool: "pin", pin: { title: "Well" } });
  });

  it("removes a pin record with nothing valid in it", () => {
    const el = checkElement("p1", record({ link: 5 }));
    expect(el?.customData).toEqual({ tool: "pin" });
  });

  it("keeps a valid pin record as it is", () => {
    const details = { title: "Well", link: "https://example.org/" };
    expect(checkElement("p1", record(details))?.customData).toEqual({
      tool: "pin",
      pin: details,
    });
  });
});
