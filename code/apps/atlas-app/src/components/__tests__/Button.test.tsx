// SPDX-License-Identifier: AGPL-3.0-only
//
// The app's one button. Its look is CSS and is checked by eye; what a test
// can hold is what the button tells the browser.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { Button } from "../Button";

afterEach(cleanup);

describe("Button", () => {
  it("does not submit the form it sits in", () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Button>Apply</Button>
      </form>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("a toggle states whether it is pressed; a plain button states nothing", () => {
    render(
      <>
        <Button pressed>On</Button>
        <Button pressed={false}>Off</Button>
        <Button>Plain</Button>
      </>,
    );
    const pressed = (name: string) =>
      screen.getByRole("button", { name }).getAttribute("aria-pressed");
    expect(pressed("On")).toBe("true");
    expect(pressed("Off")).toBe("false");
    expect(pressed("Plain")).toBeNull();
  });
});
