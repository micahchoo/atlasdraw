import { afterEach, describe, expect, it, vi } from "vitest";

import { libraryBackendUrl, libraryBrowseUrl } from "./libraryLinks";

describe("library links", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("are absent when the build sets no library URLs", () => {
    vi.stubEnv("VITE_APP_LIBRARY_URL", "");
    vi.stubEnv("VITE_APP_LIBRARY_BACKEND", "");
    expect(libraryBrowseUrl()).toBeNull();
    expect(libraryBackendUrl()).toBeNull();
  });

  it("use the configured URLs", () => {
    vi.stubEnv("VITE_APP_LIBRARY_URL", "https://libs.example");
    vi.stubEnv("VITE_APP_LIBRARY_BACKEND", "https://api.example");
    expect(libraryBrowseUrl()).toBe("https://libs.example");
    expect(libraryBackendUrl()).toBe("https://api.example");
  });
});
