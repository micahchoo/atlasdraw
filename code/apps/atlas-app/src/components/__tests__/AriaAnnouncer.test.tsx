// SPDX-License-Identifier: AGPL-3.0-only
// Phase 6 A14b — AriaAnnouncer tests.
//
// Asserts:
//  - Renders an aria-live="polite" region.
//  - announce("text") updates the region's textContent (after the reset tick).
//  - Two announcements in quick succession both register.
//  - Store subscription is cleared on unmount (no leaked listeners).

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

import {
  AriaAnnouncer,
  useAnnouncerStore,
} from "../AriaAnnouncer";

beforeEach(() => {
  // Reset store between tests.
  useAnnouncerStore.setState({ message: "", seq: 0 });
});

afterEach(() => {
  cleanup();
});

async function flush(): Promise<void> {
  // The component clears then setTimeout(…, 0)s the new message — await two
  // microtasks plus a macrotask to let it settle.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 5));
  });
}

describe("AriaAnnouncer", () => {
  it("renders a single aria-live polite region", () => {
    render(<AriaAnnouncer />);
    const region = screen.getByTestId("aria-announcer");
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(region.getAttribute("role")).toBe("status");
    expect(region.getAttribute("aria-atomic")).toBe("true");
  });

  it('announce("text") updates the region textContent', async () => {
    render(<AriaAnnouncer />);
    await act(async () => {
      useAnnouncerStore.getState().announce("Hello");
    });
    await flush();
    expect(screen.getByTestId("aria-announcer").textContent).toBe("Hello");
  });

  it("two announcements in quick succession both register (second wins)", async () => {
    render(<AriaAnnouncer />);
    await act(async () => {
      useAnnouncerStore.getState().announce("First");
    });
    await flush();
    expect(screen.getByTestId("aria-announcer").textContent).toBe("First");

    await act(async () => {
      useAnnouncerStore.getState().announce("Second");
    });
    await flush();
    expect(screen.getByTestId("aria-announcer").textContent).toBe("Second");
  });

  it("repeated identical messages re-trigger via the clear→set cycle", async () => {
    render(<AriaAnnouncer />);
    await act(async () => {
      useAnnouncerStore.getState().announce("Layer shown");
    });
    await flush();
    expect(screen.getByTestId("aria-announcer").textContent).toBe(
      "Layer shown",
    );
    // Same text — seq must increment so the effect re-runs and the region
    // clears + re-sets to provoke a fresh announcement.
    const before = useAnnouncerStore.getState().seq;
    await act(async () => {
      useAnnouncerStore.getState().announce("Layer shown");
    });
    await flush();
    expect(useAnnouncerStore.getState().seq).toBe(before + 1);
    expect(screen.getByTestId("aria-announcer").textContent).toBe(
      "Layer shown",
    );
  });

  it("unmount disconnects the subscription (no throw on later announce)", async () => {
    const { unmount } = render(<AriaAnnouncer />);
    unmount();
    // No element to update; announce() must not throw.
    expect(() => useAnnouncerStore.getState().announce("after-unmount")).not.toThrow();
  });
});
