// SPDX-License-Identifier: AGPL-3.0-only
// @atlasdraw/storage — Phase 6 A13c Stripe billing routes tests.
//
// The Stripe SDK is mocked at module level so:
//   - no network calls
//   - no need for the `stripe` package to be installed (CI guard)
// Tests inject a stub via `stripeFactory` on the route options.

import Fastify, { type FastifyInstance } from "fastify";
import * as tmp from "tmp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSqliteFsAdapter } from "../../adapters/sqlite-fs";
import { registerBillingRoutes, type StripeLike } from "../billing";

interface StubCalls {
  sessions: Array<Record<string, unknown>>;
}

interface ConstructEventBehavior {
  fail?: boolean;
  event?: {
    id: string;
    type: string;
    data: { object: Record<string, unknown> };
  };
}

function makeStripeStub(
  calls: StubCalls,
  behavior: () => ConstructEventBehavior,
): StripeLike {
  return {
    checkout: {
      sessions: {
        async create(params) {
          calls.sessions.push(params);
          return { url: "https://stripe.example/session-url" };
        },
      },
    },
    webhooks: {
      constructEvent(_body, _sig, _secret) {
        const b = behavior();
        if (b.fail || !b.event) {
          throw new Error("Invalid signature");
        }
        return b.event;
      },
    },
  };
}

interface BuildOpts {
  managed: boolean;
  dataDir: string;
  withStripeEnv?: boolean;
  behavior?: () => ConstructEventBehavior;
}

function buildApp(opts: BuildOpts) {
  const app = Fastify({ logger: false });
  const client = createSqliteFsAdapter({ dataDir: opts.dataDir });
  const calls: StubCalls = { sessions: [] };
  const behaviorFn = opts.behavior ?? (() => ({ fail: true }));
  registerBillingRoutes(app, {
    managed: opts.managed,
    client,
    stripeSecretKey: opts.withStripeEnv ? "sk_test_xxx" : undefined,
    stripeWebhookSecret: opts.withStripeEnv ? "whsec_xxx" : undefined,
    stripePricePro: opts.withStripeEnv ? "price_pro" : undefined,
    siteUrl: "https://atlas.example.com",
    stripeFactory: () => makeStripeStub(calls, behaviorFn),
  });
  return { app, client, calls };
}

describe("registerBillingRoutes", () => {
  let scratch: tmp.DirResult;
  let app: FastifyInstance;

  beforeEach(() => {
    scratch = tmp.dirSync({ unsafeCleanup: true });
  });
  afterEach(async () => {
    if (app) {
      await app.close();
    }
    scratch.removeCallback();
    vi.restoreAllMocks();
  });

  describe("/api/billing/checkout", () => {
    it("self-host returns 404", async () => {
      const built = buildApp({
        managed: false,
        dataDir: scratch.name,
        withStripeEnv: true,
      });
      app = built.app;
      await app.ready();
      const res = await app.inject({
        method: "POST",
        url: "/api/billing/checkout",
        payload: { workspaceId: "w", priceTier: "pro" },
      });
      expect(res.statusCode).toBe(404);
    });

    it("managed-mode without Stripe env returns 503", async () => {
      const built = buildApp({
        managed: true,
        dataDir: scratch.name,
        withStripeEnv: false,
      });
      app = built.app;
      await app.ready();
      const res = await app.inject({
        method: "POST",
        url: "/api/billing/checkout",
        payload: { workspaceId: "w", priceTier: "pro" },
      });
      expect(res.statusCode).toBe(503);
    });

    it("creates a Stripe checkout session with the right metadata", async () => {
      const built = buildApp({
        managed: true,
        dataDir: scratch.name,
        withStripeEnv: true,
      });
      app = built.app;
      await built.client.createWorkspace({
        id: "ws-1",
        name: "ws",
        plan: "free",
      });
      await app.ready();
      const res = await app.inject({
        method: "POST",
        url: "/api/billing/checkout",
        payload: { workspaceId: "ws-1", priceTier: "pro" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ url: "https://stripe.example/session-url" });
      expect(built.calls.sessions).toHaveLength(1);
      const call = built.calls.sessions[0];
      expect(call.mode).toBe("subscription");
      expect(call.metadata).toEqual({
        workspaceId: "ws-1",
        priceTier: "pro",
      });
      expect(call.line_items).toEqual([{ price: "price_pro", quantity: 1 }]);
      expect(call.success_url).toContain("ws-1");
    });

    it("404s when the workspace doesn't exist", async () => {
      const built = buildApp({
        managed: true,
        dataDir: scratch.name,
        withStripeEnv: true,
      });
      app = built.app;
      await app.ready();
      const res = await app.inject({
        method: "POST",
        url: "/api/billing/checkout",
        payload: { workspaceId: "ghost", priceTier: "pro" },
      });
      expect(res.statusCode).toBe(404);
    });

    it("400s on invalid priceTier", async () => {
      const built = buildApp({
        managed: true,
        dataDir: scratch.name,
        withStripeEnv: true,
      });
      app = built.app;
      await built.client.createWorkspace({
        id: "w",
        name: "w",
        plan: "free",
      });
      await app.ready();
      const res = await app.inject({
        method: "POST",
        url: "/api/billing/checkout",
        payload: { workspaceId: "w", priceTier: "bogus" },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("/api/billing/webhook", () => {
    it("self-host returns 404", async () => {
      const built = buildApp({
        managed: false,
        dataDir: scratch.name,
        withStripeEnv: true,
      });
      app = built.app;
      await app.ready();
      const res = await app.inject({
        method: "POST",
        url: "/api/billing/webhook",
        headers: {
          "content-type": "application/json",
          "stripe-signature": "t=0,v1=fake",
        },
        payload: JSON.stringify({ id: "evt_x", type: "x" }),
      });
      expect(res.statusCode).toBe(404);
    });

    it("rejects invalid signature with 400", async () => {
      const built = buildApp({
        managed: true,
        dataDir: scratch.name,
        withStripeEnv: true,
        behavior: () => ({ fail: true }),
      });
      app = built.app;
      await app.ready();
      const res = await app.inject({
        method: "POST",
        url: "/api/billing/webhook",
        headers: {
          "content-type": "application/json",
          "stripe-signature": "t=0,v1=fake",
        },
        payload: JSON.stringify({ id: "evt_1", type: "x" }),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "invalid_signature" });
    });

    it("rejects when stripe-signature header is missing with 400", async () => {
      const built = buildApp({
        managed: true,
        dataDir: scratch.name,
        withStripeEnv: true,
      });
      app = built.app;
      await app.ready();
      const res = await app.inject({
        method: "POST",
        url: "/api/billing/webhook",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ id: "evt_1", type: "x" }),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "missing_signature" });
    });

    it("checkout.session.completed updates the workspace plan", async () => {
      const event = {
        id: "evt_csc_1",
        type: "checkout.session.completed",
        data: {
          object: {
            customer: "cus_123",
            metadata: { workspaceId: "ws-1", priceTier: "pro" },
          },
        },
      };
      const built = buildApp({
        managed: true,
        dataDir: scratch.name,
        withStripeEnv: true,
        behavior: () => ({ event }),
      });
      app = built.app;
      await built.client.createWorkspace({
        id: "ws-1",
        name: "ws",
        plan: "free",
      });
      await app.ready();
      const res = await app.inject({
        method: "POST",
        url: "/api/billing/webhook",
        headers: {
          "content-type": "application/json",
          "stripe-signature": "t=0,v1=ok",
        },
        payload: JSON.stringify(event),
      });
      expect(res.statusCode).toBe(200);
      const ws = await built.client.getWorkspace("ws-1");
      expect(ws?.plan).toBe("pro");
      expect(ws?.stripe_customer_id).toBe("cus_123");
    });

    it("duplicate event id is idempotent (no double-update)", async () => {
      const event = {
        id: "evt_dup",
        type: "checkout.session.completed",
        data: {
          object: {
            customer: "cus_dup",
            metadata: { workspaceId: "ws-d", priceTier: "pro" },
          },
        },
      };
      const built = buildApp({
        managed: true,
        dataDir: scratch.name,
        withStripeEnv: true,
        behavior: () => ({ event }),
      });
      app = built.app;
      await built.client.createWorkspace({
        id: "ws-d",
        name: "ws",
        plan: "free",
      });
      await app.ready();

      const r1 = await app.inject({
        method: "POST",
        url: "/api/billing/webhook",
        headers: {
          "content-type": "application/json",
          "stripe-signature": "t=0,v1=ok",
        },
        payload: JSON.stringify(event),
      });
      expect(r1.statusCode).toBe(200);
      expect(r1.json()).toEqual({ status: "ok" });

      // Manually flip the plan back to free — if the second delivery
      // wasn't idempotent, it would re-update to pro.
      await built.client.updateWorkspacePlan("ws-d", "free");

      const r2 = await app.inject({
        method: "POST",
        url: "/api/billing/webhook",
        headers: {
          "content-type": "application/json",
          "stripe-signature": "t=0,v1=ok",
        },
        payload: JSON.stringify(event),
      });
      expect(r2.statusCode).toBe(200);
      expect(r2.json()).toEqual({ status: "already_processed" });
      // Plan should still be "free" — proves no double-update.
      const ws = await built.client.getWorkspace("ws-d");
      expect(ws?.plan).toBe("free");
    });

    it("customer.subscription.deleted reverts plan to free", async () => {
      const event = {
        id: "evt_sub_del",
        type: "customer.subscription.deleted",
        data: { object: { customer: "cus_sub" } },
      };
      const built = buildApp({
        managed: true,
        dataDir: scratch.name,
        withStripeEnv: true,
        behavior: () => ({ event }),
      });
      app = built.app;
      await built.client.createWorkspace({
        id: "ws-sub",
        name: "ws",
        plan: "pro",
      });
      // Plant the customer id link.
      await built.client.updateWorkspacePlan("ws-sub", "pro", "cus_sub");
      await app.ready();
      const res = await app.inject({
        method: "POST",
        url: "/api/billing/webhook",
        headers: {
          "content-type": "application/json",
          "stripe-signature": "t=0,v1=ok",
        },
        payload: JSON.stringify(event),
      });
      expect(res.statusCode).toBe(200);
      const ws = await built.client.getWorkspace("ws-sub");
      expect(ws?.plan).toBe("free");
    });

    it("unknown event type is a 200 no-op (forward-compat)", async () => {
      const event = {
        id: "evt_unk",
        type: "invoice.created",
        data: { object: {} },
      };
      const built = buildApp({
        managed: true,
        dataDir: scratch.name,
        withStripeEnv: true,
        behavior: () => ({ event }),
      });
      app = built.app;
      await app.ready();
      const res = await app.inject({
        method: "POST",
        url: "/api/billing/webhook",
        headers: {
          "content-type": "application/json",
          "stripe-signature": "t=0,v1=ok",
        },
        payload: JSON.stringify(event),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: "ok" });
    });
  });
});
