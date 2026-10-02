// SPDX-License-Identifier: AGPL-3.0-only
//
// The pin details dialog: it opens with the pin's details, saves what the
// user typed onto the pin, refuses a link that is not http or https, and
// Cancel changes nothing. Every assertion reads the pin or the DOM.

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { makeFakeExcalidraw } from "../state/__tests__/fixtures/documentWorld";
import { readPinDetails } from "../state/pinDetails";

import { PinDetailsDialog } from "./PinDetailsDialog";

afterEach(cleanup);

function setup(details: Record<string, unknown> = {}) {
  const fx = makeFakeExcalidraw([
    {
      id: "p",
      type: "ellipse",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      version: 1,
      isDeleted: false,
      customData: { tool: "pin", pin: details },
    } as never,
  ]);
  let closed = 0;
  render(
    <PinDetailsDialog
      api={fx.api}
      pinId="p"
      onClose={() => {
        closed += 1;
      }}
    />,
  );
  const saved = () =>
    readPinDetails(
      (fx.all()[0] as unknown as { customData: unknown }).customData,
    );
  return { saved, closed: () => closed };
}

describe("PinDetailsDialog", () => {
  it("opens with the pin's details", () => {
    setup({ title: "Well", description: "Dug 1902." });
    expect(
      (screen.getByTestId("pin-details-title") as HTMLInputElement).value,
    ).toBe("Well");
    expect(
      (screen.getByTestId("pin-details-description") as HTMLTextAreaElement)
        .value,
    ).toBe("Dug 1902.");
  });

  it("saves what was typed onto the pin, and closes", () => {
    const { saved, closed } = setup();
    fireEvent.change(screen.getByTestId("pin-details-title"), {
      target: { value: "Well" },
    });
    fireEvent.change(screen.getByTestId("pin-details-link"), {
      target: { value: "https://example.org/well" },
    });
    fireEvent.click(screen.getByTestId("pin-details-save"));

    expect(saved()).toEqual({
      title: "Well",
      link: "https://example.org/well",
    });
    expect(closed()).toBe(1);
  });

  it("refuses a link that is not http or https, says why, and saves nothing", () => {
    const { saved, closed } = setup({ title: "Well" });
    fireEvent.change(screen.getByTestId("pin-details-link"), {
      // eslint-disable-next-line no-script-url
      target: { value: "javascript:alert(1)" },
    });
    fireEvent.click(screen.getByTestId("pin-details-save"));

    expect(screen.getByTestId("pin-details-error").textContent).toMatch(
      /https/,
    );
    expect(saved()).toEqual({ title: "Well" });
    expect(closed()).toBe(0);
  });

  it("Cancel changes nothing", () => {
    const { saved, closed } = setup({ title: "Well" });
    fireEvent.change(screen.getByTestId("pin-details-title"), {
      target: { value: "Changed" },
    });
    fireEvent.click(screen.getByTestId("pin-details-cancel"));
    expect(saved()).toEqual({ title: "Well" });
    expect(closed()).toBe(1);
  });
});
