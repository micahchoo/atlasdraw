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

function renderShell(sheetName: React.ReactNode, panelInset?: number) {
  return render(
    <CollarShell map={null} sheetName={sheetName} panelInset={panelInset}>
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

// The sheet panel reflows the plate rather than covering it, and the number that
// makes that happen is one custom property on the shell. Two surfaces read it —
// the MapLibre layer (MapEditor.module.css) and the lon graticule, whose ticks
// are laid out across the *map's* width, not the plate's. Both are CSS, which
// jsdom does not compute, so what is testable here is the property's value: get
// it wrong and both readers are wrong together.
describe("CollarShell sheet-panel inset", () => {
  it("publishes 0px when no panel is reserving space", () => {
    renderShell(<span>Ward survey</span>);

    const shell = screen.getByTestId("collar-shell");
    expect(shell.style.getPropertyValue("--ad-sheet-panel-inset")).toBe("0px");
  });

  it("publishes the reserved width when the panel is open and docked", () => {
    renderShell(<span>Ward survey</span>, 302);

    const shell = screen.getByTestId("collar-shell");
    expect(shell.style.getPropertyValue("--ad-sheet-panel-inset")).toBe(
      "302px",
    );
  });

  it("tracks a resized panel", () => {
    renderShell(<span>Ward survey</span>, 480);

    expect(
      screen
        .getByTestId("collar-shell")
        .style.getPropertyValue("--ad-sheet-panel-inset"),
    ).toBe("480px");
  });
});
