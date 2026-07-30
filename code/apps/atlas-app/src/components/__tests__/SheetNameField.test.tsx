// SPDX-License-Identifier: AGPL-3.0-only
// SheetNameField — click-to-edit document name in the collar head bar.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { SheetNameField } from "../SheetNameField";
import {
  DEFAULT_DOCUMENT_TITLE,
  useDocumentTitleStore,
} from "../../state/documentTitle";
import { usePersistenceStore } from "../../state/usePersistenceStore";

const label = () => screen.getByTestId("collar-sheet-name");
const input = () =>
  screen.getByTestId("collar-sheet-name-input") as HTMLInputElement;

let markDirty: ReturnType<typeof vi.fn>;

beforeEach(() => {
  useDocumentTitleStore.setState({ title: DEFAULT_DOCUMENT_TITLE });
  markDirty = vi.fn();
  usePersistenceStore.setState({ markDirty });
});

afterEach(() => {
  cleanup();
});

describe("SheetNameField", () => {
  it("renders the document name as a button at rest", () => {
    render(<SheetNameField />);
    expect(label().textContent).toBe(DEFAULT_DOCUMENT_TITLE);
    expect(screen.queryByTestId("collar-sheet-name-input")).toBeNull();
  });

  it("opens an input with the name pre-selected on click", () => {
    render(<SheetNameField />);
    fireEvent.click(label());

    expect(input().value).toBe(DEFAULT_DOCUMENT_TITLE);
    expect(document.activeElement).toBe(input());
    expect(input().selectionStart).toBe(0);
    expect(input().selectionEnd).toBe(DEFAULT_DOCUMENT_TITLE.length);
  });

  it("commits on Enter and marks the document dirty", () => {
    render(<SheetNameField />);
    fireEvent.click(label());
    fireEvent.change(input(), { target: { value: "Bidar wards" } });
    fireEvent.keyDown(input(), { key: "Enter" });

    expect(useDocumentTitleStore.getState().title).toBe("Bidar wards");
    expect(label().textContent).toBe("Bidar wards");
    expect(markDirty).toHaveBeenCalledTimes(1);
  });

  it("commits on blur", () => {
    render(<SheetNameField />);
    fireEvent.click(label());
    fireEvent.change(input(), { target: { value: "Deccan plateau" } });
    fireEvent.blur(input());

    expect(useDocumentTitleStore.getState().title).toBe("Deccan plateau");
    expect(markDirty).toHaveBeenCalledTimes(1);
  });

  it("restores the previous name on Escape", () => {
    render(<SheetNameField />);
    fireEvent.click(label());
    fireEvent.change(input(), { target: { value: "discard me" } });
    fireEvent.keyDown(input(), { key: "Escape" });

    expect(useDocumentTitleStore.getState().title).toBe(DEFAULT_DOCUMENT_TITLE);
    expect(label().textContent).toBe(DEFAULT_DOCUMENT_TITLE);
    expect(markDirty).not.toHaveBeenCalled();
  });

  it("treats a cleared box as a cancel, not a rename to blank", () => {
    useDocumentTitleStore.setState({ title: "Keep me" });
    render(<SheetNameField />);
    fireEvent.click(label());
    fireEvent.change(input(), { target: { value: "   " } });
    fireEvent.keyDown(input(), { key: "Enter" });

    expect(useDocumentTitleStore.getState().title).toBe("Keep me");
    expect(markDirty).not.toHaveBeenCalled();
  });

  it("does not mark dirty when the name is unchanged", () => {
    render(<SheetNameField />);
    fireEvent.click(label());
    fireEvent.blur(input());

    expect(markDirty).not.toHaveBeenCalled();
  });

  it("trims surrounding whitespace off a committed name", () => {
    render(<SheetNameField />);
    fireEvent.click(label());
    fireEvent.change(input(), { target: { value: "  Ward 3  " } });
    fireEvent.keyDown(input(), { key: "Enter" });

    expect(useDocumentTitleStore.getState().title).toBe("Ward 3");
  });
});
