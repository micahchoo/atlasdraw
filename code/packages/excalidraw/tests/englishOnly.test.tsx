import React from "react";

import { Excalidraw } from "../index";
import { getLanguage, languages, t } from "../i18n";

import { render } from "./test-utils";

// Atlasdraw addition (ADR-0010). The editor ships English only. A host that
// asks for another language gets English, and no other locale is bundled.

describe("English only", () => {
  it("offers English as the only real language", () => {
    expect(
      languages
        .map((lang) => lang.code)
        .filter((code) => !code.startsWith("__test__")),
    ).toEqual(["en"]);
  });

  it("renders in English when the host asks for another language", async () => {
    await render(<Excalidraw langCode="de-DE" />);
    expect(getLanguage().code).toBe("en");
    expect(document.documentElement.lang).toBe("en");
    expect(t("toolBar.rectangle")).toBe("Rectangle");
  });
});
