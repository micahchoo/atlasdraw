// SPDX-License-Identifier: AGPL-3.0-only
// SheetNameField — click-to-edit document name in the collar head bar.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { SheetNameField } from "../SheetNameField";
import { DEFAULT_DOCUMENT_TITLE, currentDocument } from "../../state/document";

const label = () => screen.getByTestId("collar-sheet-name");
const input = () =>
  screen.getByTestId("collar-sheet-name-input") as HTMLInputElement;

/**
 * Commands the open document took since the test began. A rename is one
 * command; each command raises the revision, and the persistence wiring
 * marks the document dirty when the revision rises.
 */
let baseline = 0;
const commands = () => currentDocument().revision - baseline;

beforeEach(() => {
  baseline = currentDocument().revision;
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

  it("commits on Enter as one document command", () => {
    render(<SheetNameField />);
    fireEvent.click(label());
    fireEvent.change(input(), { target: { value: "Bidar wards" } });
    fireEvent.keyDown(input(), { key: "Enter" });

    expect(currentDocument().snapshot().title).toBe("Bidar wards");
    expect(label().textContent).toBe("Bidar wards");
    expect(commands()).toBe(1);
  });

  it("commits on blur", () => {
    render(<SheetNameField />);
    fireEvent.click(label());
    fireEvent.change(input(), { target: { value: "Deccan plateau" } });
    fireEvent.blur(input());

    expect(currentDocument().snapshot().title).toBe("Deccan plateau");
    expect(commands()).toBe(1);
  });

  it("restores the previous name on Escape", () => {
    render(<SheetNameField />);
    fireEvent.click(label());
    fireEvent.change(input(), { target: { value: "discard me" } });
    fireEvent.keyDown(input(), { key: "Escape" });

    expect(currentDocument().snapshot().title).toBe(DEFAULT_DOCUMENT_TITLE);
    expect(label().textContent).toBe(DEFAULT_DOCUMENT_TITLE);
    expect(commands()).toBe(0);
  });

  it("treats a cleared box as a cancel, not a rename to blank", () => {
    currentDocument().dispatch({ type: "rename-document", title: "Keep me" });
    baseline = currentDocument().revision;
    render(<SheetNameField />);
    fireEvent.click(label());
    fireEvent.change(input(), { target: { value: "   " } });
    fireEvent.keyDown(input(), { key: "Enter" });

    expect(currentDocument().snapshot().title).toBe("Keep me");
    expect(commands()).toBe(0);
  });

  it("sends no command when the name is unchanged", () => {
    render(<SheetNameField />);
    fireEvent.click(label());
    fireEvent.blur(input());

    expect(commands()).toBe(0);
  });

  it("trims surrounding whitespace off a committed name", () => {
    render(<SheetNameField />);
    fireEvent.click(label());
    fireEvent.change(input(), { target: { value: "  Ward 3  " } });
    fireEvent.keyDown(input(), { key: "Enter" });

    expect(currentDocument().snapshot().title).toBe("Ward 3");
  });
});
