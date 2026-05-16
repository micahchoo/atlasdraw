// SPDX-License-Identifier: AGPL-3.0-only
// Phase 6 A13a — BillingPage tests.

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";

import { BillingPage } from "../BillingPage";
import * as appConfig from "../../config/app-config";
import type { AppConfig } from "../../config/app-config";
import type {
  HttpStorageClient,
} from "../../services/createHttpStorageClient";

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
    listWorkspaces: async () => [],
    createCheckoutSession: async () => ({
      url: "https://stripe.test/session/default",
    }),
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
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("BillingPage", () => {
  describe("managed mode", () => {
    beforeEach(() => {
      vi.spyOn(appConfig, "getAppConfig").mockReturnValue({
        ...BASE_CONFIG,
        managed: true,
      });
    });

    it("renders the three plan tiers", () => {
      render(
        <BillingPage
          client={makeClient()}
          workspaceId="ws-alpha"
          redirect={() => {}}
        />,
      );
      expect(screen.getByTestId("billing-tier-free")).toBeTruthy();
      expect(screen.getByTestId("billing-tier-pro")).toBeTruthy();
      expect(screen.getByTestId("billing-tier-pro-plus")).toBeTruthy();
    });

    it("renders the documented prices", () => {
      render(
        <BillingPage
          client={makeClient()}
          workspaceId="ws-alpha"
          redirect={() => {}}
        />,
      );
      expect(
        screen.getByTestId("billing-tier-pro-price").textContent,
      ).toContain("$9");
      expect(
        screen.getByTestId("billing-tier-pro-plus-price").textContent,
      ).toContain("$19");
    });

    it("clicking Upgrade calls createCheckoutSession then redirects", async () => {
      const createCheckoutSession = vi.fn(async () => ({
        url: "https://stripe.test/session/upgrade-pro",
      }));
      const redirect = vi.fn();
      const client = makeClient({ createCheckoutSession });
      render(
        <BillingPage
          client={client}
          workspaceId="ws-alpha"
          redirect={redirect}
        />,
      );
      fireEvent.click(screen.getByTestId("billing-tier-pro-upgrade"));
      await waitFor(() => {
        expect(createCheckoutSession).toHaveBeenCalledTimes(1);
      });
      expect(createCheckoutSession).toHaveBeenCalledWith({
        workspaceId: "ws-alpha",
        priceTier: "pro",
      });
      await waitFor(() => {
        expect(redirect).toHaveBeenCalledWith(
          "https://stripe.test/session/upgrade-pro",
        );
      });
    });

    it("clicking Upgrade to Pro+ passes priceTier=pro-plus", async () => {
      const createCheckoutSession = vi.fn(async () => ({
        url: "https://stripe.test/session/upgrade-pro-plus",
      }));
      const client = makeClient({ createCheckoutSession });
      render(
        <BillingPage
          client={client}
          workspaceId="ws-alpha"
          redirect={() => {}}
        />,
      );
      fireEvent.click(screen.getByTestId("billing-tier-pro-plus-upgrade"));
      await waitFor(() => {
        expect(createCheckoutSession).toHaveBeenCalledWith({
          workspaceId: "ws-alpha",
          priceTier: "pro-plus",
        });
      });
    });

    it("upgrade button is disabled when workspaceId is null", () => {
      render(
        <BillingPage
          client={makeClient()}
          workspaceId={null}
          redirect={() => {}}
        />,
      );
      const btn = screen.getByTestId(
        "billing-tier-pro-upgrade",
      ) as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
      expect(btn.getAttribute("aria-disabled")).toBe("true");
    });

    it("does NOT render the self-host docs hint", () => {
      render(
        <BillingPage
          client={makeClient()}
          workspaceId="ws-alpha"
          redirect={() => {}}
        />,
      );
      expect(screen.queryByTestId("billing-page-self-host")).toBeNull();
    });

    it("surfaces an error if checkout fails (no redirect)", async () => {
      const createCheckoutSession = vi.fn(async () => {
        throw new Error("stripe down");
      });
      const redirect = vi.fn();
      const client = makeClient({ createCheckoutSession });
      render(
        <BillingPage
          client={client}
          workspaceId="ws-alpha"
          redirect={redirect}
        />,
      );
      fireEvent.click(screen.getByTestId("billing-tier-pro-upgrade"));
      await waitFor(() => {
        expect(screen.getByTestId("billing-page-error")).toBeTruthy();
      });
      expect(redirect).not.toHaveBeenCalled();
    });
  });

  describe("self-host (managed=false)", () => {
    beforeEach(() => {
      vi.spyOn(appConfig, "getAppConfig").mockReturnValue({
        ...BASE_CONFIG,
        managed: false,
      });
    });

    it("renders the docs hint and cites Q-P6-1", () => {
      render(
        <BillingPage
          client={makeClient()}
          workspaceId={null}
          redirect={() => {}}
        />,
      );
      const hint = screen.getByTestId("billing-page-self-host");
      expect(hint).toBeTruthy();
      expect(hint.textContent ?? "").toMatch(/Q-P6-1/);
      expect(
        screen.getByTestId("billing-page-self-host-docs"),
      ).toBeTruthy();
    });

    it("does NOT render upgrade buttons", () => {
      render(
        <BillingPage
          client={makeClient()}
          workspaceId={null}
          redirect={() => {}}
        />,
      );
      expect(screen.queryByTestId("billing-tier-pro-upgrade")).toBeNull();
      expect(
        screen.queryByTestId("billing-tier-pro-plus-upgrade"),
      ).toBeNull();
    });
  });
});
