// SPDX-License-Identifier: AGPL-3.0-only
// @atlasdraw/storage — Phase 6 A13c: Stripe checkout + webhook.
//
// Two endpoints — both managed-mode only. Self-host servers return 404.
//
//   POST /api/billing/checkout — create a Stripe Checkout Session for a
//                                workspace. Body: {workspaceId, priceTier}.
//                                Returns {url: session.url}.
//   POST /api/billing/webhook  — receive Stripe webhook events. Verifies
//                                signature, dispatches handlers, emits
//                                `stripe_webhook_received` per ADR-0011.
//
// Stripe SDK is loaded lazily (require in the handler) so the self-host
// build doesn't need the `stripe` package installed at all.
//
// Idempotency: a 30-day TTL in-memory Set tracks processed event IDs.
// Redis is the proper home for production multi-instance deploys — TODO
// post-v1. v1 single-instance hosting accepts the loss-on-restart window.

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { StorageClient, WorkspacePlan } from "../types";

// Subset of Stripe's types we actually use. Avoids a top-level
// `import type Stripe from "stripe"` which would still pull the package
// at typecheck time. Matches v17 SDK shape.
interface StripeWebhookEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

interface StripeLike {
  checkout: {
    sessions: {
      create(params: Record<string, unknown>): Promise<{ url: string | null }>;
    };
  };
  webhooks: {
    constructEvent(
      body: string | Buffer,
      sig: string | string[],
      secret: string,
    ): StripeWebhookEvent;
  };
}

export interface BillingRoutesOptions {
  managed: boolean;
  client: StorageClient;
  stripeSecretKey?: string;
  stripeWebhookSecret?: string;
  stripePricePro?: string;
  stripePricePro25?: string;
  siteUrl: string;
  /**
   * Optional Stripe SDK injection for tests. Production code path is the
   * lazy `require("stripe")` inside `getStripe()`. Tests pass a stub here
   * so they don't need the SDK installed and never make network calls.
   */
  stripeFactory?: (secretKey: string) => StripeLike;
}

const IDEMPOTENCY_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface ProcessedEvent {
  id: string;
  ts: number;
}

/**
 * In-memory processed-event store. Single-instance only. See module docstring.
 */
class IdempotencyStore {
  private entries = new Map<string, number>();

  has(id: string): boolean {
    this.gc();
    return this.entries.has(id);
  }

  add(id: string): void {
    this.entries.set(id, Date.now());
  }

  size(): number {
    this.gc();
    return this.entries.size;
  }

  private gc(): void {
    const cutoff = Date.now() - IDEMPOTENCY_TTL_MS;
    for (const [id, ts] of this.entries) {
      if (ts < cutoff) {
        this.entries.delete(id);
      }
    }
  }
}

function getStripe(opts: BillingRoutesOptions): StripeLike {
  if (!opts.stripeSecretKey) {
    throw new Error("STRIPE_SECRET_KEY not configured");
  }
  if (opts.stripeFactory) {
    return opts.stripeFactory(opts.stripeSecretKey);
  }
  // Lazy require — keeps `stripe` out of the self-host build's static
  // import graph. Cast at the require call site to avoid a top-level
  // import type that would still pull the package at typecheck.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const StripeCtor = require("stripe") as new (
    key: string,
    opts?: Record<string, unknown>,
  ) => StripeLike;
  return new StripeCtor(opts.stripeSecretKey, {
    apiVersion: "2024-12-18.acacia",
  });
}

function priceIdForTier(
  tier: WorkspacePlan,
  opts: BillingRoutesOptions,
): string | undefined {
  if (tier === "pro") {
    return opts.stripePricePro;
  }
  if (tier === "pro_25") {
    return opts.stripePricePro25;
  }
  return undefined;
}

export function registerBillingRoutes(
  fastify: FastifyInstance,
  opts: BillingRoutesOptions,
): void {
  const idempotency = new IdempotencyStore();

  // Stripe sends `application/json` but needs the RAW body for signature
  // verification — Fastify's default parser would JSON.parse and lose
  // the bytes. Replace the default JSON parser with one that captures
  // the raw Buffer for the webhook route and JSON.parses for everything
  // else. `removeContentTypeParser` is required first because Fastify
  // forbids re-adding an existing content-type parser.
  fastify.removeContentTypeParser("application/json");
  fastify.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (req, body, done) => {
      const url = (req as { url?: string }).url ?? "";
      if (url.split("?")[0] === "/api/billing/webhook") {
        // Attach the raw bytes so the handler can hand them to
        // stripe.webhooks.constructEvent. Fastify will also set
        // `request.body` to this Buffer.
        (req as unknown as { rawBody: Buffer }).rawBody = body as Buffer;
        return done(null, body);
      }
      try {
        const text = (body as Buffer).toString("utf8");
        const parsed = text.length === 0 ? {} : JSON.parse(text);
        done(null, parsed);
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  fastify.post<{
    Body: { workspaceId?: string; priceTier?: WorkspacePlan };
  }>("/api/billing/checkout", async (request, reply) => {
    if (!opts.managed) {
      return reply.code(404).send({ error: "not found" });
    }
    if (!opts.stripeSecretKey) {
      return reply.code(503).send({ error: "stripe_not_configured" });
    }
    const body = (request.body ?? {}) as {
      workspaceId?: string;
      priceTier?: WorkspacePlan;
    };
    const { workspaceId, priceTier } = body;
    if (!workspaceId || !priceTier) {
      return reply
        .code(400)
        .send({ error: "workspaceId_and_priceTier_required" });
    }
    if (priceTier !== "pro" && priceTier !== "pro_25") {
      return reply.code(400).send({ error: "invalid_priceTier" });
    }
    const priceId = priceIdForTier(priceTier, opts);
    if (!priceId) {
      return reply.code(503).send({ error: "price_not_configured" });
    }
    const ws = await opts.client.getWorkspace(workspaceId);
    if (!ws) {
      return reply.code(404).send({ error: "workspace_not_found" });
    }
    const stripe = getStripe(opts);
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${opts.siteUrl}/billing/success?ws=${workspaceId}`,
      cancel_url: `${opts.siteUrl}/billing/cancel`,
      metadata: { workspaceId, priceTier },
    });
    return reply.code(200).send({ url: session.url });
  });

  fastify.post(
    "/api/billing/webhook",
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!opts.managed) {
        return reply.code(404).send({ error: "not found" });
      }
      if (!opts.stripeSecretKey || !opts.stripeWebhookSecret) {
        return reply.code(503).send({ error: "stripe_not_configured" });
      }
      const sig = request.headers["stripe-signature"];
      if (!sig) {
        return reply.code(400).send({ error: "missing_signature" });
      }
      // The webhook parser attaches the raw bytes here; fall back to
      // `request.body` if Fastify happened to also stash it there.
      const rawBody =
        (request as unknown as { rawBody?: Buffer }).rawBody ??
        (request.body as Buffer | undefined);
      if (!rawBody || !Buffer.isBuffer(rawBody)) {
        return reply.code(400).send({ error: "raw_body_required" });
      }

      let event: StripeWebhookEvent;
      try {
        const stripe = getStripe(opts);
        event = stripe.webhooks.constructEvent(
          rawBody,
          sig,
          opts.stripeWebhookSecret,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        request.log.warn({ err: msg }, "stripe_webhook_signature_failed");
        return reply.code(400).send({ error: "invalid_signature" });
      }

      if (idempotency.has(event.id)) {
        return reply.code(200).send({ status: "already_processed" });
      }
      idempotency.add(event.id);

      // ADR-0011: `stripe_webhook_received` event.
      const customerId =
        (event.data.object as { customer?: string }).customer ?? null;
      request.log.info(
        {
          eventType: event.type,
          customerId,
          timestamp: new Date().toISOString(),
        },
        "stripe_webhook_received",
      );

      try {
        await dispatchEvent(event, opts);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        request.log.error(
          { err: msg, eventId: event.id, eventType: event.type },
          "stripe_webhook_dispatch_failed",
        );
        return reply.code(500).send({ error: "dispatch_failed" });
      }

      return reply.code(200).send({ status: "ok" });
    },
  );
}

async function dispatchEvent(
  event: StripeWebhookEvent,
  opts: BillingRoutesOptions,
): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const obj = event.data.object as {
        metadata?: { workspaceId?: string; priceTier?: WorkspacePlan };
        customer?: string;
      };
      const workspaceId = obj.metadata?.workspaceId;
      const priceTier = obj.metadata?.priceTier;
      if (!workspaceId || !priceTier) {
        return;
      }
      if (priceTier !== "pro" && priceTier !== "pro_25") {
        return;
      }
      await opts.client.updateWorkspacePlan(
        workspaceId,
        priceTier,
        obj.customer ?? null,
      );
      return;
    }
    case "customer.subscription.deleted":
      {
        const obj = event.data.object as { customer?: string };
        const customerId = obj.customer;
        if (!customerId) {
          return;
        }
        const ws = await opts.client.findWorkspaceByStripeCustomerId(
          customerId,
        );
        if (!ws) {
          return;
        }
        await opts.client.updateWorkspacePlan(ws.id, "free");
      }
      break;
    default:
    // Forward-compat: unknown event types are 200-OK no-ops.
  }
}

// Internals exposed for tests (idempotency store + ttl).
export const __billingInternals = {
  IDEMPOTENCY_TTL_MS,
  IdempotencyStore,
};
export type { StripeLike, StripeWebhookEvent, ProcessedEvent };
