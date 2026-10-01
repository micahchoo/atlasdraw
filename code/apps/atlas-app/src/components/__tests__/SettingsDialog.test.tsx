// SPDX-License-Identifier: AGPL-3.0-only
// Tests for SettingsDialog's Storage + Collaboration tabs (ISSUES.md Issue 7
// — silence audit). Before this fix, StorageTab read a VITE_STORAGE_MODE env
// var that doesn't exist anywhere in app-config.ts's schema and always
// rendered a hardcoded "Connected" status regardless of real reachability;
// CollaborationTab read a similarly nonexistent VITE_REALTIME_URL. Both now
// read the real AppConfig, and storage status is a live check.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import * as appConfigModule from "../../config/app-config";
import { SettingsDialog } from "../SettingsDialog";

import type { AppConfig } from "../../config/app-config";

const BASE_CONFIG: AppConfig = {
  buildTarget: "local-only",
  realtime: { enabled: false, wsUrl: undefined },
  enableBackendPersistence: false,
  showDemoBadge: false,
  storageBaseUrl: "",
  geocoder: undefined,
  allowRemoteBasemaps: false,
  embedEnabled: true,
  pmtilesPath: "/data/world-low-zoom.pmtiles",
  appVersion: "unknown",
  gitHash: "unknown",
};

function openStorageTab() {
  fireEvent.click(screen.getByTestId("settings-tab-storage"));
}

function openCollabTab() {
  fireEvent.click(screen.getByTestId("settings-tab-collaboration"));
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("SettingsDialog — StorageTab", () => {
  it("shows local-only mode and never fetches when no backend is configured", () => {
    vi.spyOn(appConfigModule, "getAppConfig").mockReturnValue(BASE_CONFIG);
    render(<SettingsDialog onCloseRequest={() => {}} />);
    openStorageTab();

    expect(screen.getByTestId("storage-mode").textContent).toContain(
      "Local-only (IndexedDB)",
    );
    expect(screen.queryByTestId("storage-status")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("checks real reachability and reports Connected on a healthy backend", async () => {
    vi.spyOn(appConfigModule, "getAppConfig").mockReturnValue({
      ...BASE_CONFIG,
      enableBackendPersistence: true,
      storageBaseUrl: "https://api.example.test",
    });
    vi.mocked(fetch).mockResolvedValue({ ok: true } as Response);

    render(<SettingsDialog onCloseRequest={() => {}} />);
    openStorageTab();

    expect(fetch).toHaveBeenCalledWith("https://api.example.test/health");
    await screen.findByText("Connected");
  });

  it("reports Unreachable — not a fake Connected — when the health check fails", async () => {
    vi.spyOn(appConfigModule, "getAppConfig").mockReturnValue({
      ...BASE_CONFIG,
      enableBackendPersistence: true,
      storageBaseUrl: "https://api.example.test",
    });
    vi.mocked(fetch).mockRejectedValue(new Error("network error"));

    render(<SettingsDialog onCloseRequest={() => {}} />);
    openStorageTab();

    await screen.findByText("Unreachable");
  });
});

describe("SettingsDialog — CollaborationTab", () => {
  it("shows Disabled when realtime isn't configured, not a nonexistent env var", () => {
    vi.spyOn(appConfigModule, "getAppConfig").mockReturnValue(BASE_CONFIG);
    render(<SettingsDialog onCloseRequest={() => {}} />);
    openCollabTab();

    expect(screen.getByTestId("realtime-url").textContent).toContain(
      "Disabled",
    );
    expect(
      screen.getByText("Disabled — no realtime server configured"),
    ).toBeTruthy();
  });

  it("shows the real configured WS URL and enabled presence when realtime is on", () => {
    vi.spyOn(appConfigModule, "getAppConfig").mockReturnValue({
      ...BASE_CONFIG,
      realtime: { enabled: true, wsUrl: "wss://realtime.example.test" },
    });
    render(<SettingsDialog onCloseRequest={() => {}} />);
    openCollabTab();

    expect(screen.getByTestId("realtime-url").textContent).toBe(
      "wss://realtime.example.test",
    );
    expect(screen.getByText("Cursor + viewport sharing enabled")).toBeTruthy();
  });
});

describe("SettingsDialog — tabs", () => {
  it("offers storage and collaboration; the basemap is chosen in the Layers panel", () => {
    vi.spyOn(appConfigModule, "getAppConfig").mockReturnValue(BASE_CONFIG);
    render(<SettingsDialog onCloseRequest={() => {}} />);

    const tabs = screen
      .getAllByRole("button")
      .map((b) => b.getAttribute("data-testid"))
      .filter((id) => id?.startsWith("settings-tab-"));
    expect(tabs).toEqual([
      "settings-tab-storage",
      "settings-tab-collaboration",
    ]);
  });
});
