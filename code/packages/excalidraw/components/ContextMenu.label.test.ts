import { afterEach, describe, expect, it, vi } from "vitest";

import { defaultLang, setLanguage } from "../i18n";

import { menuItemLabel } from "./ContextMenu";

describe("menuItemLabel", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // Host apps register items with literal labels. In production a missing
  // translation key returns "" instead of throwing, so the literal must be
  // the fallback, not a catch branch.
  it("shows a literal label in a production build", async () => {
    vi.stubEnv("PROD", true);
    await setLanguage(defaultLang);
    expect(menuItemLabel("Convert to data layer")).toBe(
      "Convert to data layer",
    );
  });

  it("still translates a real key", async () => {
    await setLanguage(defaultLang);
    expect(menuItemLabel("labels.copy")).toBe("Copy");
  });
});
