// SPDX-License-Identifier: AGPL-3.0-only
//
// `CommentModeButton` — the comment-mode toggle on the drawing-tools toolbar.
//
// Inherited from the "SheetRail — comment mode" block, which pinned this
// contract while the toggle lived on the right icon rail. The assertions came
// with it because they were never about the rail: a mode toggle must read as
// pressed rather than expanded, and the open-thread count must reach a screen
// reader rather than being a coloured dot — the failure mode the design doc
// warns about now that comments have no permanent surface.
//
// `globals: false` in `apps/atlas-app/vitest.config.ts` is why describe/it/
// expect are imported, and why jest-dom matchers are unavailable (hence plain
// attribute assertions below).

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { CommentModeButton } from "../CommentModeButton";

afterEach(cleanup);

describe("CommentModeButton", () => {
  it("is a toggle, not a disclosure", () => {
    render(<CommentModeButton active={false} onToggle={() => {}} />);

    const button = screen.getByTestId("comment-mode-button");
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("type")).toBe("button");
    // A mode changes what a click on the plate does; it opens no panel. So
    // `aria-expanded` and `aria-controls` would both be lies.
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(button.hasAttribute("aria-expanded")).toBe(false);
    expect(button.hasAttribute("aria-controls")).toBe(false);
    // icon-only, same as the native tool buttons it sits beside
    expect(button.textContent).toBe("");
    expect(button.getAttribute("aria-label")).toBe("Comment mode");
  });

  it("fires onToggle on click", () => {
    let toggles = 0;
    render(<CommentModeButton active={false} onToggle={() => toggles++} />);

    fireEvent.click(screen.getByTestId("comment-mode-button"));
    expect(toggles).toBe(1);
  });

  it("reflects the active mode as aria-pressed", () => {
    render(<CommentModeButton active onToggle={() => {}} />);
    expect(
      screen.getByTestId("comment-mode-button").getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("puts the open-thread count in the accessible name, not only the badge", () => {
    const { rerender } = render(
      <CommentModeButton
        active={false}
        onToggle={() => {}}
        openThreadCount={3}
      />,
    );

    // The badge glyph itself is aria-hidden — announcing "3" twice is noise —
    // so the ONLY path to the count for a screen reader is the button's name.
    // `getByRole(name:)` runs the real accessible-name computation.
    expect(
      screen.getByRole("button", { name: "Comment mode, 3 open threads" }),
    ).toBe(screen.getByTestId("comment-mode-button"));
    const badge = screen.getByTestId("comment-mode-badge");
    expect(badge.textContent).toBe("3");
    expect(badge.getAttribute("aria-hidden")).toBe("true");

    // singular, because "1 open threads" is the tell of a count nobody read
    rerender(
      <CommentModeButton
        active={false}
        onToggle={() => {}}
        openThreadCount={1}
      />,
    );
    expect(
      screen.getByTestId("comment-mode-button").getAttribute("aria-label"),
    ).toBe("Comment mode, 1 open thread");

    // and the badge caps rather than blowing out the 2rem tool button
    rerender(
      <CommentModeButton
        active={false}
        onToggle={() => {}}
        openThreadCount={140}
      />,
    );
    expect(screen.getByTestId("comment-mode-badge").textContent).toBe("99+");
  });

  it("shows no badge at zero", () => {
    render(
      <CommentModeButton
        active={false}
        onToggle={() => {}}
        openThreadCount={0}
      />,
    );
    expect(screen.queryByTestId("comment-mode-badge")).toBe(null);
    expect(
      screen.getByTestId("comment-mode-button").getAttribute("aria-label"),
    ).toBe("Comment mode");
  });
});
