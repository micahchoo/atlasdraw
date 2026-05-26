// SPDX-License-Identifier: AGPL-3.0-only
// Phase 6 A13a — WorkspaceSwitcher tests.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";

import { WorkspaceSwitcher } from "../WorkspaceSwitcher";
import * as appConfig from "../../config/app-config";

import type { AppConfig } from "../../config/app-config";
import type {
  HttpStorageClient,
  WorkspaceSummary,
} from "../../services/createHttpStorageClient";

const SAMPLE: WorkspaceSummary[] = [
  { id: "ws-alpha", name: "Alpha", plan: "free" },
  { id: "ws-beta", name: "Beta", plan: "pro" },
  { id: "ws-gamma", name: "Gamma", plan: "free" },
];

function makeClient(
  overrides: Partial<HttpStorageClient> = {},
): HttpStorageClient {
  const fail = async () => {
    throw new Error("not implemented in this test");
  };
  return {
    createMap: fail,
    getMap: fail,
    updateMap: fail,
    createShareToken: fail,
    resolveToken: fail,
    getShareBlob: fail,
    listWorkspaces: async () => SAMPLE,
    createCheckoutSession: fail,
    ...overrides,
  } as HttpStorageClient;
}

const BASE_CONFIG: AppConfig = {
  buildTarget: "hosted",
  enableShareUI: true,
  realtime: { enabled: false, wsUrl: undefined },
  enableBackendPersistence: true,
  showDemoBadge: false,
  storageBaseUrl: "",
  maputnikUrl: "https://maputnik.github.io/editor/",
  geocoder: undefined,
  managed: true,
  allowRemoteBasemaps: false,
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("WorkspaceSwitcher", () => {
  describe("self-host (managed=false)", () => {
    beforeEach(() => {
      vi.spyOn(appConfig, "getAppConfig").mockReturnValue({
        ...BASE_CONFIG,
        managed: false,
      });
    });

    it("renders nothing", () => {
      const client = makeClient();
      const { container } = render(
        <WorkspaceSwitcher
          client={client}
          activeId={null}
          onSelect={() => {}}
        />,
      );
      expect(container.firstChild).toBeNull();
      expect(screen.queryByTestId("workspace-switcher")).toBeNull();
    });

    it("does not call listWorkspaces in self-host", () => {
      const list = vi.fn(async () => SAMPLE);
      const client = makeClient({ listWorkspaces: list });
      render(
        <WorkspaceSwitcher
          client={client}
          activeId={null}
          onSelect={() => {}}
        />,
      );
      expect(list).not.toHaveBeenCalled();
    });
  });

  describe("managed mode", () => {
    beforeEach(() => {
      vi.spyOn(appConfig, "getAppConfig").mockReturnValue({
        ...BASE_CONFIG,
        managed: true,
      });
    });

    it("lists all workspaces returned by listWorkspaces", async () => {
      const client = makeClient();
      render(
        <WorkspaceSwitcher
          client={client}
          activeId="ws-alpha"
          onSelect={() => {}}
        />,
      );
      // Open the dropdown.
      await waitFor(() => {
        expect(screen.getByTestId("workspace-switcher-trigger")).toBeTruthy();
      });
      fireEvent.click(screen.getByTestId("workspace-switcher-trigger"));
      await waitFor(() => {
        expect(screen.getByTestId("workspace-switcher-list")).toBeTruthy();
      });
      for (const ws of SAMPLE) {
        expect(
          screen.getByTestId(`workspace-switcher-option-${ws.id}`),
        ).toBeTruthy();
      }
    });

    it("clicking a workspace option fires onSelect with the new id", async () => {
      const onSelect = vi.fn();
      const client = makeClient();
      render(
        <WorkspaceSwitcher
          client={client}
          activeId="ws-alpha"
          onSelect={onSelect}
        />,
      );
      await waitFor(() => {
        expect(screen.getByTestId("workspace-switcher-trigger")).toBeTruthy();
      });
      fireEvent.click(screen.getByTestId("workspace-switcher-trigger"));
      await waitFor(() => {
        expect(
          screen.getByTestId("workspace-switcher-option-ws-beta"),
        ).toBeTruthy();
      });
      fireEvent.click(screen.getByTestId("workspace-switcher-option-ws-beta"));
      expect(onSelect).toHaveBeenCalledWith("ws-beta");
    });

    it("free-tier workspaces show an Upgrade link", async () => {
      const client = makeClient();
      render(
        <WorkspaceSwitcher
          client={client}
          activeId="ws-alpha"
          onSelect={() => {}}
        />,
      );
      await waitFor(() => {
        expect(screen.getByTestId("workspace-switcher-trigger")).toBeTruthy();
      });
      fireEvent.click(screen.getByTestId("workspace-switcher-trigger"));
      await waitFor(() => {
        expect(screen.getByTestId("workspace-switcher-list")).toBeTruthy();
      });
      // Alpha + Gamma are free, Beta is pro. Both free entries get an
      // upgrade link; Beta does not.
      expect(
        screen.getByTestId("workspace-switcher-upgrade-ws-alpha"),
      ).toBeTruthy();
      expect(
        screen.getByTestId("workspace-switcher-upgrade-ws-gamma"),
      ).toBeTruthy();
      expect(
        screen.queryByTestId("workspace-switcher-upgrade-ws-beta"),
      ).toBeNull();
    });

    it("clicking Upgrade routes to /billing via the navigate hook", async () => {
      const navigate = vi.fn();
      const client = makeClient();
      render(
        <WorkspaceSwitcher
          client={client}
          activeId="ws-alpha"
          onSelect={() => {}}
          navigateToBilling={navigate}
        />,
      );
      await waitFor(() => {
        expect(screen.getByTestId("workspace-switcher-trigger")).toBeTruthy();
      });
      fireEvent.click(screen.getByTestId("workspace-switcher-trigger"));
      await waitFor(() => {
        expect(
          screen.getByTestId("workspace-switcher-upgrade-ws-alpha"),
        ).toBeTruthy();
      });
      fireEvent.click(
        screen.getByTestId("workspace-switcher-upgrade-ws-alpha"),
      );
      expect(navigate).toHaveBeenCalledTimes(1);
      expect(navigate).toHaveBeenCalledWith("ws-alpha");
    });

    it("the trigger label reflects the active workspace name", async () => {
      const client = makeClient();
      render(
        <WorkspaceSwitcher
          client={client}
          activeId="ws-beta"
          onSelect={() => {}}
        />,
      );
      await waitFor(() => {
        const btn = screen.getByTestId("workspace-switcher-trigger");
        expect(btn.textContent ?? "").toContain("Beta");
      });
    });
  });
});
