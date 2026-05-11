// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";

import { BasemapRemoteGatedError, resolveStyle } from "../resolver";

describe("resolveStyle — remote gate", () => {
  it("rejects with BasemapRemoteGatedError when allowRemote=false", async () => {
    await expect(
      resolveStyle("openfreemap-bright", {
        allowRemote: false,
        pmtilesPath: "unused.pmtiles",
      }),
    ).rejects.toBeInstanceOf(BasemapRemoteGatedError);
  });

  it("attaches the offending basemapId to the error", async () => {
    let caught: unknown;
    try {
      await resolveStyle("openfreemap-bright", {
        allowRemote: false,
        pmtilesPath: "unused.pmtiles",
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(BasemapRemoteGatedError);
    expect((caught as BasemapRemoteGatedError).basemapId).toBe(
      "openfreemap-bright",
    );
  });

  it("resolves the remote basemap when allowRemote=true", async () => {
    const style = await resolveStyle("openfreemap-bright", {
      allowRemote: true,
      pmtilesPath: "unused.pmtiles",
    });
    expect(style).toMatchObject({
      version: 8,
      sources: expect.any(Object),
      layers: expect.any(Array),
    });
  });

  it("resolves a self-hosted basemap even when allowRemote=false", async () => {
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
      resolveStyle("not-a-real-id" as never, {
        allowRemote: true,
        pmtilesPath: "unused.pmtiles",
      }),
    ).rejects.toThrow(/Unknown basemap id/);
  });
});
