import { describe, expect, it } from "vitest";

import { loadAppConfig } from "../app-config";

const target = (VITE_BUILD_TARGET?: string) => ({ VITE_BUILD_TARGET });

describe("loadAppConfig", () => {
  it("returns hosted-tier flags when VITE_BUILD_TARGET=hosted", () => {
    const cfg = loadAppConfig(target("hosted"));
    expect(cfg.buildTarget).toBe("hosted");
    // Realtime defaults to disabled even on hosted — opt-in gate.
    expect(cfg.realtime.enabled).toBe(false);
    expect(cfg.realtime.wsUrl).toBeUndefined();
    expect(cfg.enableBackendPersistence).toBe(true);
    expect(cfg.showDemoBadge).toBe(false);
  });

  it("enables realtime on hosted when VITE_REALTIME_ENABLED=true", () => {
    const cfg = loadAppConfig({
      VITE_BUILD_TARGET: "hosted",
      VITE_REALTIME_ENABLED: "true",
      VITE_REALTIME_WS_URL: "ws://localhost:4001",
    });
    expect(cfg.realtime.enabled).toBe(true);
    expect(cfg.realtime.wsUrl).toBe("ws://localhost:4001");
  });

  it("leaves wsUrl undefined when VITE_REALTIME_WS_URL is empty", () => {
    const cfg = loadAppConfig({
      VITE_BUILD_TARGET: "hosted",
      VITE_REALTIME_ENABLED: "true",
      VITE_REALTIME_WS_URL: "",
    });
    expect(cfg.realtime.enabled).toBe(true);
    expect(cfg.realtime.wsUrl).toBeUndefined();
  });

  it.each(["pages", "local-only"])(
    "realtime stays disabled on %s even when env says true",
    (t) => {
      const cfg = loadAppConfig({
        VITE_BUILD_TARGET: t,
        VITE_REALTIME_ENABLED: "true",
        VITE_REALTIME_WS_URL: "ws://localhost:4001",
      });
      expect(cfg.realtime.enabled).toBe(false);
    },
  );

  it("returns demo-badge + no power features when VITE_BUILD_TARGET=pages", () => {
    const cfg = loadAppConfig(target("pages"));
    expect(cfg.buildTarget).toBe("pages");
    expect(cfg.realtime.enabled).toBe(false);
    expect(cfg.enableBackendPersistence).toBe(false);
    expect(cfg.showDemoBadge).toBe(true);
  });

  it("returns no power features and no badge when VITE_BUILD_TARGET=local-only", () => {
    const cfg = loadAppConfig(target("local-only"));
    expect(cfg.buildTarget).toBe("local-only");
    expect(cfg.realtime.enabled).toBe(false);
    expect(cfg.enableBackendPersistence).toBe(false);
    expect(cfg.showDemoBadge).toBe(false);
  });

  it("defaults to local-only when nothing is set (dev runs)", () => {
    const cfg = loadAppConfig({});
    expect(cfg.buildTarget).toBe("local-only");
    expect(cfg.realtime.enabled).toBe(false);
    expect(cfg.showDemoBadge).toBe(false);
    expect(cfg.embedEnabled).toBe(true);
    expect(cfg.pmtilesPath).toBe("/data/world-low-zoom.pmtiles");
    expect(cfg.appVersion).toBe("unknown");
    expect(cfg.gitHash).toBe("unknown");
  });

  it("ignores env keys it does not know", () => {
    expect(() =>
      loadAppConfig({ MODE: "development", BASE_URL: "/", DEV: "true" }),
    ).not.toThrow();
  });

  describe("an invalid value names the variable that is wrong", () => {
    const flags = [
      "VITE_BUILD_TARGET",
      "VITE_REALTIME_ENABLED",
      "VITE_ALLOW_REMOTE_BASEMAPS",
      "VITE_EMBED_ENABLED",
    ];
    it.each([
      ["VITE_BUILD_TARGET", "staging"],
      ["VITE_REALTIME_ENABLED", "yes"],
      ["VITE_ALLOW_REMOTE_BASEMAPS", "1"],
      ["VITE_EMBED_ENABLED", "off"],
    ])("%s=%s", (name, value) => {
      let message = "";
      try {
        loadAppConfig({ [name]: value });
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message).toContain(name);
      expect(message).toContain(JSON.stringify(value));
      for (const other of flags.filter((f) => f !== name)) {
        expect(message).not.toContain(other);
      }
    });
  });

  it("defaults storageBaseUrl to empty string (same-origin) when env is unset", () => {
    expect(loadAppConfig(target("hosted")).storageBaseUrl).toBe("");
  });

  it("propagates VITE_STORAGE_BASE_URL, on any target", () => {
    const cfg = loadAppConfig({
      VITE_BUILD_TARGET: "local-only",
      VITE_STORAGE_BASE_URL: "http://localhost:4000",
    });
    expect(cfg.storageBaseUrl).toBe("http://localhost:4000");
    expect(cfg.enableBackendPersistence).toBe(false);
  });

  it("leaves geocoder undefined when VITE_GEOCODER_ENDPOINT is unset or blank", () => {
    expect(loadAppConfig(target("hosted")).geocoder).toBeUndefined();
    expect(
      loadAppConfig({ VITE_GEOCODER_ENDPOINT: "   " }).geocoder,
    ).toBeUndefined();
  });

  it("populates geocoder.endpoint on any target", () => {
    const cfg = loadAppConfig({
      VITE_BUILD_TARGET: "local-only",
      VITE_GEOCODER_ENDPOINT: "https://photon.example",
    });
    expect(cfg.geocoder).toEqual({ endpoint: "https://photon.example" });
  });

  it("allowRemoteBasemaps defaults to true; VITE_ALLOW_REMOTE_BASEMAPS=false turns it off", () => {
    expect(loadAppConfig({}).allowRemoteBasemaps).toBe(true);
    expect(
      loadAppConfig({ VITE_ALLOW_REMOTE_BASEMAPS: "false" })
        .allowRemoteBasemaps,
    ).toBe(false);
  });

  it("VITE_EMBED_ENABLED=false turns the embed route off", () => {
    expect(loadAppConfig({ VITE_EMBED_ENABLED: "false" }).embedEnabled).toBe(
      false,
    );
  });

  it("reads the pmtiles path, version and git hash", () => {
    const cfg = loadAppConfig({
      VITE_PMTILES_PATH: "/atlasdraw/data/world-low-zoom.pmtiles",
      VITE_APP_VERSION: "1.2.3",
      VITE_GIT_HASH: "abc1234",
    });
    expect(cfg.pmtilesPath).toBe("/atlasdraw/data/world-low-zoom.pmtiles");
    expect(cfg.appVersion).toBe("1.2.3");
    expect(cfg.gitHash).toBe("abc1234");
  });
});
