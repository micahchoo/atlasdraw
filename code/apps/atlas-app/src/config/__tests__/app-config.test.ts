import { describe, expect, it } from "vitest";
import { loadAppConfig } from "../app-config";

describe("loadAppConfig", () => {
  it("returns hosted-tier flags when VITE_BUILD_TARGET=hosted", () => {
    const cfg = loadAppConfig("hosted");
    expect(cfg.buildTarget).toBe("hosted");
    expect(cfg.enableShareUI).toBe(true);
    // Realtime defaults to disabled even on hosted — opt-in gate.
    expect(cfg.realtime.enabled).toBe(false);
    expect(cfg.realtime.wsUrl).toBeUndefined();
    expect(cfg.enableBackendPersistence).toBe(true);
    expect(cfg.showDemoBadge).toBe(false);
  });

  it("enables realtime on hosted when VITE_REALTIME_ENABLED=true", () => {
    const cfg = loadAppConfig("hosted", undefined, "true", "ws://localhost:4001");
    expect(cfg.realtime.enabled).toBe(true);
    expect(cfg.realtime.wsUrl).toBe("ws://localhost:4001");
  });

  it("leaves wsUrl undefined when VITE_REALTIME_WS_URL is empty", () => {
    const cfg = loadAppConfig("hosted", undefined, "true", "");
    expect(cfg.realtime.enabled).toBe(true);
    expect(cfg.realtime.wsUrl).toBeUndefined();
  });

  it("realtime stays disabled on pages even when env says true", () => {
    const cfg = loadAppConfig("pages", undefined, "true", "ws://localhost:4001");
    expect(cfg.realtime.enabled).toBe(false);
  });

  it("realtime stays disabled on local-only even when env says true", () => {
    const cfg = loadAppConfig("local-only", undefined, "true", "ws://localhost:4001");
    expect(cfg.realtime.enabled).toBe(false);
  });

  it("returns demo-badge + no power features when VITE_BUILD_TARGET=pages", () => {
    const cfg = loadAppConfig("pages");
    expect(cfg.buildTarget).toBe("pages");
    expect(cfg.enableShareUI).toBe(false);
    expect(cfg.realtime.enabled).toBe(false);
    expect(cfg.enableBackendPersistence).toBe(false);
    expect(cfg.showDemoBadge).toBe(true);
  });

  it("returns no power features and no badge when VITE_BUILD_TARGET=local-only", () => {
    const cfg = loadAppConfig("local-only");
    expect(cfg.buildTarget).toBe("local-only");
    expect(cfg.enableShareUI).toBe(false);
    expect(cfg.realtime.enabled).toBe(false);
    expect(cfg.enableBackendPersistence).toBe(false);
    expect(cfg.showDemoBadge).toBe(false);
  });

  it("defaults to local-only when VITE_BUILD_TARGET is undefined (dev runs)", () => {
    const cfg = loadAppConfig(undefined);
    expect(cfg.buildTarget).toBe("local-only");
    expect(cfg.realtime.enabled).toBe(false);
    expect(cfg.showDemoBadge).toBe(false);
  });

  it("throws with a named-var error when VITE_BUILD_TARGET is invalid", () => {
    expect(() => loadAppConfig("staging")).toThrow(/VITE_BUILD_TARGET/);
    expect(() => loadAppConfig("staging")).toThrow(/"staging"/);
  });

  // T13 — VITE_STORAGE_BASE_URL.
  it("defaults storageBaseUrl to empty string (same-origin) when env is unset", () => {
    const cfg = loadAppConfig("hosted", undefined);
    expect(cfg.storageBaseUrl).toBe("");
  });

  it("propagates VITE_STORAGE_BASE_URL when provided", () => {
    const cfg = loadAppConfig("hosted", "http://localhost:4000");
    expect(cfg.storageBaseUrl).toBe("http://localhost:4000");
  });

  it("storageBaseUrl is set even on non-hosted targets (consumer gates on enableBackendPersistence)", () => {
    const cfg = loadAppConfig("local-only", "http://localhost:4000");
    expect(cfg.storageBaseUrl).toBe("http://localhost:4000");
    expect(cfg.enableBackendPersistence).toBe(false);
  });

  // Phase 6 A4 — VITE_MAPUTNIK_URL.
  it("defaults maputnikUrl to the public Maputnik instance when env is unset", () => {
    const cfg = loadAppConfig("local-only", undefined, undefined, undefined, undefined);
    expect(cfg.maputnikUrl).toBe("https://maputnik.github.io/editor/");
  });

  it("propagates VITE_MAPUTNIK_URL when provided (self-hosted Maputnik)", () => {
    const cfg = loadAppConfig(
      "local-only",
      undefined,
      undefined,
      undefined,
      "https://maputnik.example.org/editor/",
    );
    expect(cfg.maputnikUrl).toBe("https://maputnik.example.org/editor/");
  });

  // Phase 6 A8 — VITE_GEOCODER_ENDPOINT.
  it("leaves geocoder undefined when VITE_GEOCODER_ENDPOINT is unset (zero call-home)", () => {
    const cfg = loadAppConfig("hosted", undefined, undefined, undefined, undefined, undefined);
    expect(cfg.geocoder).toBeUndefined();
  });

  it("leaves geocoder undefined when VITE_GEOCODER_ENDPOINT is empty / whitespace", () => {
    const cfg = loadAppConfig("hosted", undefined, undefined, undefined, undefined, "   ");
    expect(cfg.geocoder).toBeUndefined();
  });

  it("populates geocoder.endpoint when VITE_GEOCODER_ENDPOINT is set", () => {
    const cfg = loadAppConfig(
      "hosted",
      undefined,
      undefined,
      undefined,
      undefined,
      "https://photon.example",
    );
    expect(cfg.geocoder).toEqual({ endpoint: "https://photon.example" });
  });

  it("geocoder works on local-only target too (it's a build-time opt-in, not tier-gated)", () => {
    const cfg = loadAppConfig(
      "local-only",
      undefined,
      undefined,
      undefined,
      undefined,
      "https://photon.example",
    );
    expect(cfg.geocoder).toEqual({ endpoint: "https://photon.example" });
  });
});
