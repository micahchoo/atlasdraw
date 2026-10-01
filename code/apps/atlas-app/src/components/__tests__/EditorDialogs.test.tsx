// SPDX-License-Identifier: AGPL-3.0-only
//
// EditorDialogs shows the session's one open dialog. The palette and the
// shortcuts panel render from the command list.

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { COMMANDS, paletteCommands } from "../../commands/commands";
import {
  testSession,
  withSession,
} from "../../session/__tests__/sessionFixture";
import { EditorDialogs } from "../EditorDialogs";
import { ToastProvider } from "../ToastProvider";

import type { EditorSession } from "../../session/EditorSession";

let session: EditorSession;

function renderDialogs() {
  return render(
    <ToastProvider>
      {withSession(<EditorDialogs startRoom={null} />, session)}
    </ToastProvider>,
  );
}

beforeEach(() => {
  session = testSession();
});
afterEach(cleanup);

describe("the palette", () => {
  it("lists every command the palette offers now, and only those", () => {
    act(() => session.view.getState().openDialog({ kind: "palette" }));
    renderDialogs();

    const shown = screen
      .getAllByTestId(/^quick-action-/)
      .map((el) =>
        el.getAttribute("data-testid")!.slice("quick-action-".length),
      );

    expect(shown.sort()).toEqual(
      paletteCommands(session)
        .map((c) => c.id)
        .sort(),
    );
    for (const id of shown) {
      expect(COMMANDS.some((c) => c.id === id)).toBe(true);
    }
  });

  it("a picked command closes the palette and runs", async () => {
    act(() => session.view.getState().openDialog({ kind: "palette" }));
    renderDialogs();

    fireEvent.click(screen.getByTestId("quick-action-help.about"));

    expect(session.view.getState().dialog).toEqual({ kind: "about" });
    expect(await screen.findByTestId("about-dialog-overlay")).toBeTruthy();
    expect(screen.queryByTestId("quick-actions-panel")).toBeNull();
  });
});

describe("the shortcuts panel", () => {
  it("opens with a row for comment mode's key", () => {
    act(() => session.view.getState().openDialog({ kind: "shortcuts" }));
    renderDialogs();

    expect(
      screen.getByTestId("shortcut-row-Comment mode").textContent,
    ).toContain("C");
  });
});

describe("a question", () => {
  it("shows the question and answers with the button the user presses", async () => {
    renderDialogs();
    let answer: Promise<boolean> = Promise.resolve(false);
    act(() => {
      answer = session.view.getState().ask({
        title: "Clear the drawing?",
        body: "Every shape is deleted.",
        confirmLabel: "Clear the drawing",
      });
    });

    expect(screen.getByTestId("confirm-dialog").textContent).toContain(
      "Clear the drawing?",
    );
    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));

    await expect(answer).resolves.toBe(true);
    expect(screen.queryByTestId("confirm-dialog")).toBeNull();
  });
});

describe("the palette for a screen reader", () => {
  it("is a combobox that names the active option, and the arrows move it", () => {
    act(() => session.view.getState().openDialog({ kind: "palette" }));
    renderDialogs();

    const box = screen.getByRole("combobox", { name: "Search commands" });
    const listbox = screen.getByRole("listbox", { name: "Commands" });
    expect(box.getAttribute("aria-controls")).toBe(listbox.id);
    const first = box.getAttribute("aria-activedescendant");
    expect(document.getElementById(first!)?.getAttribute("aria-selected")).toBe(
      "true",
    );

    fireEvent.keyDown(box, { key: "ArrowDown" });

    const second = box.getAttribute("aria-activedescendant");
    expect(second).not.toBe(first);
    expect(
      document.getElementById(second!)?.getAttribute("aria-selected"),
    ).toBe("true");
    expect(document.getElementById(first!)?.getAttribute("aria-selected")).toBe(
      "false",
    );
  });
});

describe("the first-run tour", () => {
  beforeEach(() => localStorage.clear());

  it("is a dialog in the slot, named by its step, and Escape ends it for good", () => {
    act(() => session.view.getState().openDialog({ kind: "onboarding" }));
    renderDialogs();

    const tour = screen.getByRole("dialog", { name: "Welcome to Atlasdraw" });
    expect(tour.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(document.activeElement!, { key: "Escape" });

    expect(session.view.getState().dialog).toBeNull();
    expect(localStorage.getItem("atlasdraw-onboarding-dismissed")).toBe("1");
  });
});
