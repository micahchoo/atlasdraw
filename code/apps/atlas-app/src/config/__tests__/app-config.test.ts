import { describe, expect, it } from "vitest";
import { loadAppConfig } from "../app-config";

describe("loadAppConfig", () => {
  it("returns hosted-tier flags when VITE_BUILD_TARGET=hosted", () => {
    const cfg = loadAppConfig("hosted");
    expect(cfg.buildTarget).toBe("hosted");
    expect(cfg.enableShareUI).toBe(true);
    expect(cfg.enableRealtime).toBe(true);
    expect(cfg.enableBackendPersistence).toBe(true);
    expect(cfg.showDemoBadge).toBe(false);
  });

  it("returns demo-badge + no power features when VITE_BUILD_TARGET=pages", () => {
    const cfg = loadAppConfig("pages");
    expect(cfg.buildTarget).toBe("pages");
    expect(cfg.enableShareUI).toBe(false);
    expect(cfg.enableRealtime).toBe(false);
    expect(cfg.enableBackendPersistence).toBe(false);
    expect(cfg.showDemoBadge).toBe(true);
  });

  it("returns no power features and no badge when VITE_BUILD_TARGET=local-only", () => {
    const cfg = loadAppConfig("local-only");
    expect(cfg.buildTarget).toBe("local-only");
    expect(cfg.enableShareUI).toBe(false);
    expect(cfg.enableRealtime).toBe(false);
    expect(cfg.enableBackendPersistence).toBe(false);
    expect(cfg.showDemoBadge).toBe(false);
  });

  it("defaults to local-only when VITE_BUILD_TARGET is undefined (dev runs)", () => {
    const cfg = loadAppConfig(undefined);
    expect(cfg.buildTarget).toBe("local-only");
    expect(cfg.showDemoBadge).toBe(false);
  });

  it("throws with a named-var error when VITE_BUILD_TARGET is invalid", () => {
    expect(() => loadAppConfig("staging")).toThrow(/VITE_BUILD_TARGET/);
    expect(() => loadAppConfig("staging")).toThrow(/"staging"/);
  });
});
