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
      ).toThrow(
        /Missing required env var: DATABASE_URL.*postgres-minio/,
      );
    });
  });

  describe("sqlite-fs mode", () => {
    it("parses a minimal env (DATA_DIR defaulted)", () => {
      const cfg = loadConfig({ STORAGE_MODE: "sqlite-fs" });
      expect(cfg.STORAGE_MODE).toBe("sqlite-fs");
      if (cfg.STORAGE_MODE === "sqlite-fs") {
        expect(cfg.DATA_DIR).toBe("/data");
      }
    });

    it("honors an explicit DATA_DIR", () => {
      const cfg = loadConfig({
        STORAGE_MODE: "sqlite-fs",
        DATA_DIR: "/var/atlas",
      });
      if (cfg.STORAGE_MODE === "sqlite-fs") {
        expect(cfg.DATA_DIR).toBe("/var/atlas");
      }
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
});
