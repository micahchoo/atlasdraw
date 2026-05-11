// SPDX-License-Identifier: AGPL-3.0-only
// Phase 4 T14 — AboutDialog tests.
//
// Default render (no VITE_BUILD_TARGET set) → buildTarget "local-only", no
// demo note. Demo-badge path is covered by app-config.test.ts; the dialog
// just reads `showDemoBadge` from getAppConfig() — a separate render path
// would require module mocking, which adds more friction than value here.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";

import { AboutDialog } from "../AboutDialog";

afterEach(() => {
  cleanup();
});

describe("AboutDialog", () => {
  it("renders version, license, and telemetry policy", () => {
    render(<AboutDialog onCloseRequest={() => {}} />);

    expect(screen.getByTestId("about-dialog-version")).toBeTruthy();
    expect(screen.getByTestId("about-dialog-git-hash")).toBeTruthy();
    expect(screen.getByText("AGPL-3.0")).toBeTruthy();
    expect(screen.getByTestId("about-dialog-telemetry").textContent).toMatch(
      /No analytics\. No call-home\. No required API keys\./,
    );
  });

  it("shows the active build target label", () => {
    render(<AboutDialog onCloseRequest={() => {}} />);
    const label = screen.getByTestId("about-dialog-build-target");
    // Default in tests is "local-only" because VITE_BUILD_TARGET is unset.
    expect(label.textContent).toMatch(/Local edition/);
  });

  it("hides the demo note when not on the pages build", () => {
    render(<AboutDialog onCloseRequest={() => {}} />);
    expect(screen.queryByTestId("about-dialog-demo-note")).toBeNull();
  });

  it("invokes onCloseRequest when the Close button is clicked", () => {
    const handleClose = vi.fn();
    render(<AboutDialog onCloseRequest={handleClose} />);
    fireEvent.click(screen.getByTestId("about-dialog-close"));
    expect(handleClose).toHaveBeenCalledTimes(1);
  });
});
