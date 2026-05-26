// SPDX-License-Identifier: AGPL-3.0-only
// Phase 6 A12 — AssetLibraryPanel tests.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { AssetLibraryPanel } from "../AssetLibraryPanel";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/**
 * Build a minimal mock ExcalidrawImperativeAPI. We only stub the methods the
 * panel calls (`updateLibrary`, `toggleSidebar`) — everything else can be
 * undefined since TypeScript is satisfied by the `as` cast at the call site.
 */
function makeMockExcalidrawAPI(): ExcalidrawImperativeAPI {
  return {
    updateLibrary: vi.fn().mockResolvedValue([]),
    toggleSidebar: vi.fn().mockReturnValue(true),
    // Other fields are not touched by AssetLibraryPanel; cast to satisfy TS.
  } as unknown as ExcalidrawImperativeAPI;
}

describe("AssetLibraryPanel", () => {
  it("renders with role=dialog and the documented aria-label", () => {
    const api = makeMockExcalidrawAPI();
    render(<AssetLibraryPanel excalidrawAPI={api} onCloseRequest={() => {}} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-label")).toBe("Asset library");
  });

  it("renders the three atlas-curated library groups with item counts", () => {
    const api = makeMockExcalidrawAPI();
    render(<AssetLibraryPanel excalidrawAPI={api} onCloseRequest={() => {}} />);
    // Each fixture's source field surfaces as a group testid.
    expect(
      screen.getByTestId("asset-library-group-atlasdraw:wildfire-icons"),
    ).toBeTruthy();
    expect(
      screen.getByTestId("asset-library-group-atlasdraw:transit-symbols"),
    ).toBeTruthy();
    expect(
      screen.getByTestId("asset-library-group-atlasdraw:hazard-markers"),
    ).toBeTruthy();
    // Each group reports a non-zero item count.
    for (const group of screen.getAllByTestId(/^asset-library-group-/)) {
      expect(group.textContent).toMatch(/\d+ items/);
    }
  });

  it("calls excalidrawAPI.updateLibrary once on mount with merge: true", () => {
    const api = makeMockExcalidrawAPI();
    render(<AssetLibraryPanel excalidrawAPI={api} onCloseRequest={() => {}} />);
    expect(api.updateLibrary).toHaveBeenCalledTimes(1);
    const arg = (api.updateLibrary as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(arg.merge).toBe(true);
    expect(Array.isArray(arg.libraryItems)).toBe(true);
    // At least the 9 items shipped across the 3 fixtures (3 per group).
    expect(arg.libraryItems.length).toBeGreaterThanOrEqual(9);
  });

  it("toggleSidebar fires with DEFAULT_SIDEBAR.name + library tab on button click", () => {
    const api = makeMockExcalidrawAPI();
    const onClose = vi.fn();
    render(<AssetLibraryPanel excalidrawAPI={api} onCloseRequest={onClose} />);
    fireEvent.click(screen.getByTestId("asset-library-view"));
    // Per code/packages/common/src/constants.ts:432-438 — name="default",
    // tab="library". The panel must use the addressable form, not
    // toggleSidebar({ name: "library" }) which would no-op.
    expect(api.toggleSidebar).toHaveBeenCalledWith({
      name: "default",
      tab: "library",
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders MIT license attribution for each library", () => {
    const api = makeMockExcalidrawAPI();
    render(<AssetLibraryPanel excalidrawAPI={api} onCloseRequest={() => {}} />);
    const attribution = screen.getByTestId("asset-library-attribution");
    expect(attribution.textContent).toContain("MIT");
    // One license line per shipped library.
    expect(
      screen.getByTestId("asset-library-license-atlasdraw:wildfire-icons"),
    ).toBeTruthy();
    expect(
      screen.getByTestId("asset-library-license-atlasdraw:transit-symbols"),
    ).toBeTruthy();
    expect(
      screen.getByTestId("asset-library-license-atlasdraw:hazard-markers"),
    ).toBeTruthy();
  });

  it("close button fires onCloseRequest", () => {
    const onClose = vi.fn();
    render(
      <AssetLibraryPanel
        excalidrawAPI={makeMockExcalidrawAPI()}
        onCloseRequest={onClose}
      />,
    );
    fireEvent.click(screen.getByTestId("asset-library-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("disables the View button and skips API calls when excalidrawAPI is null", () => {
    render(
      <AssetLibraryPanel excalidrawAPI={null} onCloseRequest={() => {}} />,
    );
    const view = screen.getByTestId("asset-library-view") as HTMLButtonElement;
    expect(view.disabled).toBe(true);
    // Still renders the group list — the panel is informational even if API
    // isn't ready yet.
    expect(
      screen.getByTestId("asset-library-group-atlasdraw:wildfire-icons"),
    ).toBeTruthy();
  });
});
