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
  enableShareUI: false,
  realtime: { enabled: false, wsUrl: undefined },
  enableBackendPersistence: false,
  showDemoBadge: false,
  storageBaseUrl: "",
  maputnikUrl: "https://maputnik.github.io/editor/",
  geocoder: undefined,
  managed: false,
  allowRemoteBasemaps: false,
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
    render(
      <SettingsDialog
        activeBasemapId="protomaps-light"
        onBasemapChange={() => {}}
        onCloseRequest={() => {}}
      />,
    );
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

    render(
      <SettingsDialog
        activeBasemapId="protomaps-light"
        onBasemapChange={() => {}}
        onCloseRequest={() => {}}
      />,
    );
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

    render(
      <SettingsDialog
        activeBasemapId="protomaps-light"
        onBasemapChange={() => {}}
        onCloseRequest={() => {}}
      />,
    );
    openStorageTab();

    await screen.findByText("Unreachable");
  });
});

describe("SettingsDialog — CollaborationTab", () => {
  it("shows Disabled when realtime isn't configured, not a nonexistent env var", () => {
    vi.spyOn(appConfigModule, "getAppConfig").mockReturnValue(BASE_CONFIG);
    render(
      <SettingsDialog
        activeBasemapId="protomaps-light"
        onBasemapChange={() => {}}
        onCloseRequest={() => {}}
      />,
    );
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
    render(
      <SettingsDialog
        activeBasemapId="protomaps-light"
        onBasemapChange={() => {}}
        onCloseRequest={() => {}}
      />,
    );
    openCollabTab();

    expect(screen.getByTestId("realtime-url").textContent).toBe(
      "wss://realtime.example.test",
    );
    expect(screen.getByText("Cursor + viewport sharing enabled")).toBeTruthy();
  });
});
