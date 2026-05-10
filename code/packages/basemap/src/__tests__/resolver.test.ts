// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";

import {
  BasemapRemoteGatedError,
  getPmtilesPath,
  resolveStyle,
} from "../resolver";

describe("resolveStyle — remote gate", () => {
  it("rejects with BasemapRemoteGatedError when allowRemote=false", async () => {
    await expect(
      resolveStyle("openfreemap-bright", { allowRemote: false }),
    ).rejects.toBeInstanceOf(BasemapRemoteGatedError);
  });

  it("attaches the offending basemapId to the error", async () => {
    let caught: unknown;
    try {
      await resolveStyle("openfreemap-bright", { allowRemote: false });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(BasemapRemoteGatedError);
    expect((caught as BasemapRemoteGatedError).basemapId).toBe(
      "openfreemap-bright",
    );
  });

  it("resolves the remote basemap when allowRemote=true", async () => {
    // style-builder falls back to its placeholder spec when the vendored style
    // file is missing (Wave 0 stub state), so this resolves without hitting
    // any real network. We only need to confirm the gate passes.
    const style = await resolveStyle("openfreemap-bright", {
      allowRemote: true,
    });
    expect(style).toMatchObject({
      version: 8,
      sources: expect.any(Object),
      layers: expect.any(Array),
    });
  });

  it("resolves a self-hosted basemap even when allowRemote=false", async () => {
    // Self-hosted basemaps (requiresRemote: false) are unaffected by the gate.
    const style = await resolveStyle("protomaps-light", {
      allowRemote: false,
      pmtilesPath: "x.pmtiles",
    });
    const serialized = JSON.stringify(style);
    expect(serialized).toContain("x.pmtiles");
    expect(serialized).not.toContain("__PMTILES_PATH__");
  });
});

describe("resolveStyle — unknown ids", () => {
  it("throws on unknown basemap id", async () => {
    await expect(
      resolveStyle("not-a-real-id" as never, { allowRemote: true }),
    ).rejects.toThrow(/Unknown basemap id/);
  });
});

describe("getPmtilesPath", () => {
  it("returns the dev fallback when VITE_PMTILES_PATH is unset", () => {
    // Vitest jsdom env exposes import.meta.env but doesn't define the VITE_
    // var unless explicitly set. The fallback should kick in.
    const path = getPmtilesPath();
    expect(path).toBe("/data/world-low-zoom.pmtiles");
  });
});
