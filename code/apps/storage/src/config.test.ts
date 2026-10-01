import { describe, expect, it } from "vitest";

import { loadConfig } from "./config";

describe("loadConfig", () => {
  describe("postgres-minio mode", () => {
    it("parses a complete env", () => {
      const cfg = loadConfig({
        STORAGE_MODE: "postgres-minio",
        DATABASE_URL: "postgres://localhost/atlas",
        BLOB_ENDPOINT: "http://minio:9000",
        BLOB_ACCESS_KEY: "k",
        BLOB_SECRET_KEY: "s",
      });
      expect(cfg.STORAGE_MODE).toBe("postgres-minio");
      expect(cfg.PORT).toBe(4000);
    });

    it("uses an explicit PORT override", () => {
      const cfg = loadConfig({
        STORAGE_MODE: "postgres-minio",
        DATABASE_URL: "x",
        BLOB_ENDPOINT: "x",
        BLOB_ACCESS_KEY: "x",
        BLOB_SECRET_KEY: "x",
        PORT: "5050",
      });
      expect(cfg.PORT).toBe(5050);
    });

    it("throws a named-var error when DATABASE_URL is missing", () => {
      expect(() =>
        loadConfig({
          STORAGE_MODE: "postgres-minio",
          BLOB_ENDPOINT: "x",
          BLOB_ACCESS_KEY: "x",
          BLOB_SECRET_KEY: "x",
        }),
      ).toThrow(/Missing required env var: DATABASE_URL.*postgres-minio/);
    });
  });

  // `toMatchObject`, not `if (cfg.STORAGE_MODE === "sqlite-fs")` around the
  // DATA_DIR assertion. An `if` that narrows the union also skips: a
  // loadConfig that returned the wrong mode would run zero assertions and
  // pass. One matcher checks both fields unconditionally.
  describe("sqlite-fs mode", () => {
    it("parses a minimal env (DATA_DIR defaulted)", () => {
      expect(loadConfig({ STORAGE_MODE: "sqlite-fs" })).toMatchObject({
        STORAGE_MODE: "sqlite-fs",
        DATA_DIR: "/data",
      });
    });

    it("honors an explicit DATA_DIR", () => {
      expect(
        loadConfig({ STORAGE_MODE: "sqlite-fs", DATA_DIR: "/var/atlas" }),
      ).toMatchObject({
        STORAGE_MODE: "sqlite-fs",
        DATA_DIR: "/var/atlas",
      });
    });
  });

  describe("TRUST_PROXY", () => {
    const base = { STORAGE_MODE: "sqlite-fs" } as const;
    it("trusts no proxy by default, so X-Forwarded-For cannot pick the client IP", () => {
      expect(loadConfig(base).TRUST_PROXY).toBe(false);
    });
    it.each([
      ["true", true],
      ["false", false],
      ["1", 1],
      ["10.0.0.0/8,127.0.0.1", "10.0.0.0/8,127.0.0.1"],
    ])("parses %s", (raw, expected) => {
      expect(loadConfig({ ...base, TRUST_PROXY: raw }).TRUST_PROXY).toBe(
        expected,
      );
    });
  });

  it("throws a named-var error when STORAGE_MODE is invalid", () => {
    expect(() => loadConfig({ STORAGE_MODE: "redis" })).toThrow(
      /STORAGE_MODE.*"redis"/,
    );
  });

  it("throws when STORAGE_MODE is unset", () => {
    expect(() => loadConfig({})).toThrow(/STORAGE_MODE/);
  });

  describe("PUBLIC_URL (T4)", () => {
    it("defaults PUBLIC_URL to '' for sqlite-fs", () => {
      const cfg = loadConfig({
        STORAGE_MODE: "sqlite-fs",
        DATA_DIR: "/tmp/x",
      });
      expect(cfg.PUBLIC_URL).toBe("");
    });

    it("honors an explicit PUBLIC_URL override", () => {
      const cfg = loadConfig({
        STORAGE_MODE: "sqlite-fs",
        DATA_DIR: "/tmp/x",
        PUBLIC_URL: "https://atlas.example.com",
      });
      expect(cfg.PUBLIC_URL).toBe("https://atlas.example.com");
    });

    it("defaults PUBLIC_URL to '' for postgres-minio", () => {
      const cfg = loadConfig({
        STORAGE_MODE: "postgres-minio",
        DATABASE_URL: "x",
        BLOB_ENDPOINT: "x",
        BLOB_ACCESS_KEY: "x",
        BLOB_SECRET_KEY: "x",
      });
      expect(cfg.PUBLIC_URL).toBe("");
    });
  });

  describe("MAX_TOTAL_BYTES and SWEEP_INTERVAL_MS", () => {
    const base = { STORAGE_MODE: "sqlite-fs", DATA_DIR: "/tmp/x" };

    it("default to no cap and an hourly sweep", () => {
      const cfg = loadConfig(base);
      expect(cfg.MAX_TOTAL_BYTES).toBe(0);
      expect(cfg.SWEEP_INTERVAL_MS).toBe(3_600_000);
    });

    it("read numbers from env", () => {
      const cfg = loadConfig({
        ...base,
        MAX_TOTAL_BYTES: "10737418240",
        SWEEP_INTERVAL_MS: "0",
      });
      expect(cfg.MAX_TOTAL_BYTES).toBe(10_737_418_240);
      expect(cfg.SWEEP_INTERVAL_MS).toBe(0);
    });

    it("refuse a negative cap by name", () => {
      expect(() => loadConfig({ ...base, MAX_TOTAL_BYTES: "-1" })).toThrow(
        /MAX_TOTAL_BYTES/,
      );
    });
  });
});
