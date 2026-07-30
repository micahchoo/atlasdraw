// SPDX-License-Identifier: AGPL-3.0-only
// CollarShell — the sheet-name slot.
//
// Regression guard: `sheetName` used to be a string the shell wrapped in its
// own styled span. It is now a slot, and the shell must render it bare — a
// leftover wrapper would double the styling and duplicate the test id on the
// field's own button.

import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { CollarShell } from "../CollarShell";

afterEach(() => {
  cleanup();
});

function renderShell(sheetName: React.ReactNode) {
  return render(
    <CollarShell map={null} sheetName={sheetName}>
      <div data-testid="plate-content" />
    </CollarShell>,
  );
}

describe("CollarShell sheet-name slot", () => {
  it("renders the slot as a direct child of the head bar", () => {
    renderShell(<button data-testid="collar-sheet-name">Ward survey</button>);

    const field = screen.getByTestId("collar-sheet-name");
    expect(field.parentElement).toBe(screen.getByTestId("collar-head"));
  });

  it("renders the slot exactly once", () => {
    renderShell(<button data-testid="collar-sheet-name">Ward survey</button>);

    expect(screen.getAllByTestId("collar-sheet-name")).toHaveLength(1);
  });

  it("keeps the wordmark separator in the frame, not in the slot", () => {
    renderShell(<button data-testid="collar-sheet-name">Ward survey</button>);

    const head = screen.getByTestId("collar-head");
    expect(head.textContent).toContain("·");
    expect(screen.getByTestId("collar-sheet-name").textContent).toBe(
      "Ward survey",
    );
  });
});
