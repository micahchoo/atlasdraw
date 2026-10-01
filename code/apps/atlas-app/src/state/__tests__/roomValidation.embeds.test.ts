// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
//
// A room peer cannot plant a live web page on everyone's map: `iframe` and
// `embeddable` elements fail the element check (ADR-0010).

import { describe, expect, it } from "vitest";

import { checkElement } from "../roomValidation";

const record = (type: string) => ({
  id: "x",
  type,
  x: 0,
  y: 0,
  width: 300,
  height: 200,
  version: 1,
  versionNonce: 1,
  isDeleted: false,
  link: "https://www.youtube.com/watch?v=gkGMXY0wekg",
  customData: {
    generationData: { status: "done", html: "<script>1</script>" },
  },
});

describe("room element check", () => {
  it("refuses iframe and embeddable elements and keeps a rectangle", () => {
    expect(checkElement("x", record("iframe"))).toBeNull();
    expect(checkElement("x", record("embeddable"))).toBeNull();
    expect(checkElement("x", record("rectangle"))).not.toBeNull();
  });
});
