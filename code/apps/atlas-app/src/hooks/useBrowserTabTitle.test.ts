// SPDX-License-Identifier: AGPL-3.0-only
// useBrowserTabTitle — document name → browser tab.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";

import {
  DEFAULT_DOCUMENT_TITLE,
  useDocumentTitleStore,
} from "../state/documentTitle";

import { useBrowserTabTitle } from "./useBrowserTabTitle";

beforeEach(() => {
  useDocumentTitleStore.setState({ title: DEFAULT_DOCUMENT_TITLE });
  document.title = "Atlasdraw";
});

afterEach(() => {
  cleanup();
});

describe("useBrowserTabTitle", () => {
  it("writes the document name into the tab on mount", () => {
    renderHook(() => useBrowserTabTitle());
    expect(document.title).toBe(`${DEFAULT_DOCUMENT_TITLE} — Atlasdraw`);
  });

  it("follows a rename", () => {
    renderHook(() => useBrowserTabTitle());
    act(() => {
      useDocumentTitleStore.getState().setTitle("Bidar wards");
    });
    expect(document.title).toBe("Bidar wards — Atlasdraw");
  });
});
