// SPDX-License-Identifier: AGPL-3.0-only
//
// Modal: the one way a dialog is modal. It names itself, takes focus, keeps
// Tab inside, closes on Escape and on a press on its scrim, makes the page
// behind it inert, and gives focus back to what opened it. Tab order and
// where focus lands in a real browser are measured in e2e/keyboard.spec.ts.

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { StrictMode, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  withSession,
  testSession,
} from "../../session/__tests__/sessionFixture";
import { Modal, ReturnFocusContext } from "../Modal";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

function Buttons() {
  return (
    <>
      <button data-testid="a">a</button>
      <button data-testid="b">b</button>
    </>
  );
}

describe("a modal dialog", () => {
  it("is a dialog, modal, named by its label", () => {
    render(
      <Modal label="Settings" onClose={() => {}}>
        <Buttons />
      </Modal>,
    );
    const dialog = screen.getByRole("dialog", { name: "Settings" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
  });

  it("can be named by its visible heading", () => {
    render(
      <Modal labelledBy="t" role="alertdialog" onClose={() => {}}>
        <h2 id="t">Delete map?</h2>
        <Buttons />
      </Modal>,
    );
    expect(
      screen.getByRole("alertdialog", { name: "Delete map?" }),
    ).toBeTruthy();
  });

  it("takes focus when it opens, and keeps Tab inside", () => {
    render(
      <Modal label="Settings" onClose={() => {}}>
        <Buttons />
      </Modal>,
    );
    expect(document.activeElement).toBe(screen.getByTestId("a"));
    const b = screen.getByTestId("b");
    b.focus();
    fireEvent.keyDown(b, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByTestId("a"));
  });

  it("closes on Escape, outside an editor too", () => {
    const onClose = vi.fn();
    render(
      <Modal label="About" onClose={onClose}>
        <Buttons />
      </Modal>,
    );
    fireEvent.keyDown(screen.getByTestId("a"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape through the editor's key scopes, above its tools", () => {
    const session = testSession();
    const tool = vi.fn(() => true);
    const popTool = session.keys.push({
      name: "pin",
      layer: "tool",
      onKey: tool,
    });
    const onClose = vi.fn();
    render(
      withSession(
        <Modal label="About" onClose={onClose}>
          <Buttons />
        </Modal>,
        session,
      ),
    );
    fireEvent.keyDown(screen.getByTestId("a"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(tool).not.toHaveBeenCalled();
    popTool();
  });

  it("closes on a press on its scrim, not on a press inside", () => {
    const onClose = vi.fn();
    render(
      <Modal label="About" onClose={onClose} scrimTestId="scrim">
        <Buttons />
      </Modal>,
    );
    fireEvent.mouseDown(screen.getByTestId("a"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(screen.getByTestId("scrim"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("can refuse the scrim (onboarding: Skip is the way out)", () => {
    const onClose = vi.fn();
    render(
      <Modal
        label="Welcome"
        onClose={onClose}
        scrimCloses={false}
        scrimTestId="scrim"
      >
        <Buttons />
      </Modal>,
    );
    fireEvent.mouseDown(screen.getByTestId("scrim"));
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("the page behind it", () => {
  function Page({ open }: { open: boolean }) {
    return (
      <div>
        <header data-testid="header">
          <button>Menu</button>
        </header>
        <div role="status" aria-live="polite" data-testid="live" />
        <main data-testid="main">
          <div data-testid="map" />
          {open && (
            <Modal label="Settings" onClose={() => {}}>
              <Buttons />
            </Modal>
          )}
        </main>
      </div>
    );
  }

  it("is inert while the dialog is open, and is not after", () => {
    const view = render(<Page open />);
    expect(screen.getByTestId("header").hasAttribute("inert")).toBe(true);
    expect(screen.getByTestId("map").hasAttribute("inert")).toBe(true);
    view.rerender(<Page open={false} />);
    expect(screen.getByTestId("header").hasAttribute("inert")).toBe(false);
    expect(screen.getByTestId("map").hasAttribute("inert")).toBe(false);
  });

  it("keeps its live regions, so a toast is still read out", () => {
    render(<Page open />);
    expect(screen.getByTestId("live").hasAttribute("inert")).toBe(false);
  });

  it("does not take back an inert it did not set", () => {
    const view = render(<Page open={false} />);
    screen.getByTestId("map").setAttribute("inert", "");
    view.rerender(<Page open />);
    view.rerender(<Page open={false} />);
    expect(screen.getByTestId("map").hasAttribute("inert")).toBe(true);
  });
});

describe("focus goes back", () => {
  function Opener() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button data-testid="opener" onClick={() => setOpen(true)}>
          Open
        </button>
        {open && (
          <Modal label="Delete map?" onClose={() => setOpen(false)}>
            <Buttons />
          </Modal>
        )}
      </>
    );
  }

  // A click with no pointer events is a "virtual" click to react-aria, which
  // moves focus a frame later (focusSafely); hence waitFor.
  it("to the element that had focus when it opened", async () => {
    render(<Opener />);
    const opener = screen.getByTestId("opener");
    opener.focus();
    fireEvent.click(opener);
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByTestId("a")),
    );
    fireEvent.keyDown(screen.getByTestId("a"), { key: "Escape" });
    expect(document.activeElement).toBe(opener);
  });

  it("to the element the slot names, when it names one", () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    const view = render(
      <ReturnFocusContext.Provider value={trigger}>
        <Modal label="Settings" onClose={() => {}}>
          <Buttons />
        </Modal>
      </ReturnFocusContext.Provider>,
    );
    act(() => view.unmount());
    expect(document.activeElement).toBe(trigger);
  });

  it("a question inside a dialog goes back to its own opener, and Escape closes only it", async () => {
    const closeOuter = vi.fn();
    function Outer() {
      const [asking, setAsking] = useState(false);
      return (
        <Modal label="My maps" onClose={closeOuter}>
          <button data-testid="delete" onClick={() => setAsking(true)}>
            Delete
          </button>
          {asking && (
            <Modal label="Delete map?" onClose={() => setAsking(false)}>
              <button data-testid="cancel">Cancel</button>
            </Modal>
          )}
        </Modal>
      );
    }
    render(<Outer />);
    const del = screen.getByTestId("delete");
    del.focus();
    fireEvent.click(del);
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByTestId("cancel")),
    );

    fireEvent.keyDown(screen.getByTestId("cancel"), { key: "Escape" });

    expect(screen.queryByTestId("cancel")).toBeNull();
    expect(closeOuter).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(del);
  });
});

describe("under StrictMode (the dev build runs every effect twice)", () => {
  it("keeps focus in the dialog, and gives it back once on close", async () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const view = render(
      <StrictMode>
        <Modal label="Command palette" onClose={() => {}}>
          <input data-testid="search" autoFocus />
        </Modal>
      </StrictMode>,
    );

    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByTestId("search")),
    );
    expect(opener.hasAttribute("inert")).toBe(true);

    act(() => view.unmount());

    expect(opener.hasAttribute("inert")).toBe(false);
    expect(document.activeElement).toBe(opener);
  });
});
