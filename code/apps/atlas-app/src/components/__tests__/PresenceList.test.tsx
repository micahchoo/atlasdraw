// SPDX-License-Identifier: AGPL-3.0-only
//
// The presence list: who is in the room, and the field where this person
// sets the name the others see.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PresenceList } from "../PresenceList";

import type { Peer } from "../../state/room";

const self = { id: "me", name: "Guest AB12", color: "#1971c2" };
const peer: Peer = {
  clientId: 7,
  user: { id: "p", name: "Bea", color: "#e03131" },
  cursor: null,
  camera: null,
};

afterEach(cleanup);

const nameField = () =>
  screen.getByTestId("presence-self-name") as HTMLInputElement;

describe("PresenceList", () => {
  it("shows this person's name field even alone in the room", () => {
    render(<PresenceList peers={[]} self={self} onRename={vi.fn()} />);

    expect(nameField().value).toBe("Guest AB12");
  });

  it("sends a new name on Enter and on leaving the field, and not an unchanged one", () => {
    const onRename = vi.fn();
    render(<PresenceList peers={[peer]} self={self} onRename={onRename} />);
    const field = nameField();

    fireEvent.change(field, { target: { value: "Ana" } });
    fireEvent.keyDown(field, { key: "Enter" });
    fireEvent.blur(field);
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(onRename).toHaveBeenCalledWith("Ana");
  });

  it("puts the name back on Escape", () => {
    const onRename = vi.fn();
    render(<PresenceList peers={[peer]} self={self} onRename={onRename} />);
    const field = nameField();

    fireEvent.change(field, { target: { value: "Typo" } });
    fireEvent.keyDown(field, { key: "Escape" });

    expect(field.value).toBe("Guest AB12");
    fireEvent.blur(field);
    expect(onRename).not.toHaveBeenCalled();
  });

  it("says how the room's connection stands, as a status line", () => {
    const { rerender } = render(
      <PresenceList
        peers={[]}
        self={self}
        connection="Offline. Reconnecting…"
      />,
    );
    expect(screen.getByRole("status").textContent).toBe(
      "Offline. Reconnecting…",
    );

    rerender(<PresenceList peers={[]} self={self} connection={null} />);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
