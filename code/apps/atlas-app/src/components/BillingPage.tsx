// SPDX-License-Identifier: AGPL-3.0-only
// Phase 6 A13a — BillingPage.
//
// Standalone route (`/billing`) that lists the plan tiers and kicks off
// Stripe checkout when an upgrade button is clicked. Wave 3 Worker 2 owns
// the server route that mints the Stripe Checkout Session — the client
// only POSTs `{workspaceId, priceTier}` and redirects to the returned URL.
// No `@stripe/stripe-js` dependency is required (Q-P6-1: the client does
// not host the third-party SDK; the redirect URL is the integration seam).
//
// Self-host (`getAppConfig().managed === false`) renders the FOSS hint
// instead of the upgrade buttons — there is no Stripe in the FOSS edition,
// and the docs hint cites Q-P6-1 inline so the cold reader knows why.
//
// Layout follows AboutDialog / MaputnikDialog: inline styles, root-level
// mount, no Excalidraw provider dependency, fully testable in jsdom.

import React, { useState } from "react";
import { getAppConfig } from "../config/app-config";
import type {
  CheckoutPriceTier,
  HttpStorageClient,
} from "../services/createHttpStorageClient";

export interface BillingPageProps {
  /**
   * HttpStorageClient — `createCheckoutSession` is the only method
   * consumed.
   */
  client: HttpStorageClient;
  /**
   * Workspace the upgrade applies to. May be `null` in degraded states
   * (unauthenticated, route loaded out of context); buttons are then
   * disabled with an explanatory `title`.
   */
  workspaceId: string | null;
  /**
   * Redirect hook — defaults to `window.location.assign`. Overridable in
   * tests so we can assert without leaving jsdom.
   */
  redirect?: (url: string) => void;
}

interface PlanTier {
  id: "free" | "pro" | "pro-plus";
  name: string;
  price: string;
  description: string;
  features: string[];
  upgradeTier?: CheckoutPriceTier;
}

const TIERS: PlanTier[] = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    description: "For getting started.",
    features: ["1 workspace", "Up to 3 maps", "Read-only share links"],
  },
  {
    id: "pro",
    name: "Pro",
    price: "$9 / mo",
    description: "Per workspace, up to 5 members.",
    features: [
      "Unlimited maps",
      "Realtime collaboration",
      "Read + write share links",
      "Anchored comments",
    ],
    upgradeTier: "pro",
  },
  {
    id: "pro-plus",
    name: "Pro+",
    price: "$19 / mo",
    description: "Per workspace, up to 25 members.",
    features: [
      "Everything in Pro",
      "Priority support",
      "Per-workspace quotas",
    ],
    upgradeTier: "pro-plus",
  },
];

export const BillingPage: React.FC<BillingPageProps> = ({
  client,
  workspaceId,
  redirect,
}) => {
  const cfg = getAppConfig();
  const [pending, setPending] = useState<CheckoutPriceTier | null>(null);
  const [error, setError] = useState<string | null>(null);

  const doRedirect = (url: string) => {
    if (redirect) {
      redirect(url);
      return;
    }
    if (typeof window !== "undefined") {
      window.location.assign(url);
    }
  };

  const handleUpgrade = async (tier: CheckoutPriceTier) => {
    if (!workspaceId) return;
    setPending(tier);
    setError(null);
    try {
      const { url } = await client.createCheckoutSession({
        workspaceId,
        priceTier: tier,
      });
      doRedirect(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPending(null);
    }
  };

  return (
    <div
      data-testid="billing-page"
      style={{
        minHeight: "100%",
        padding: "2rem 1.5rem",
        background: "#f8f9fa",
        color: "#212529",
        fontFamily: "system-ui, sans-serif",
        fontSize: 14,
        lineHeight: 1.5,
        overflowY: "auto",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          maxWidth: 960,
          margin: "0 auto",
        }}
      >
        <h1
          style={{
            margin: "0 0 0.25rem 0",
            fontSize: "1.5rem",
            fontWeight: 600,
          }}
        >
          Billing
        </h1>
        <p
          data-testid="billing-page-subtitle"
          style={{ margin: "0 0 1.5rem 0", color: "#495057" }}
        >
          Pick a plan to unlock more workspaces, members, and features.
        </p>

        {!cfg.managed ? (
          <section
            data-testid="billing-page-self-host"
            style={{
              background: "#ffffff",
              border: "1px solid #adb5bd",
              borderRadius: 6,
              padding: "1rem 1.25rem",
              marginBottom: "1rem",
            }}
          >
            <h2
              style={{
                margin: "0 0 0.5rem 0",
                fontSize: "1.125rem",
                fontWeight: 600,
              }}
            >
              Self-hosting Atlasdraw
            </h2>
            <p style={{ margin: "0 0 0.5rem 0" }}>
              You're running the FOSS edition — there is no Stripe billing
              here. Self-hosting?{" "}
              <a
                href="/docs/self-host/README.md"
                data-testid="billing-page-self-host-docs"
                style={{ color: "#1971c2" }}
              >
                See docs/self-host/README.md
              </a>{" "}
              for the FOSS edition.
            </p>
            <p
              style={{
                margin: 0,
                color: "#868e96",
                fontSize: 12,
              }}
            >
              Citation: Q-P6-1 — v1.0 ships the standalone app; managed-mode
              (Stripe + workspace quotas) is the maintainer-hosted overlay,
              not the FOSS surface.
            </p>
          </section>
        ) : null}

        <div
          data-testid="billing-page-tiers"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: "1rem",
          }}
        >
          {TIERS.map((tier) => (
            <article
              key={tier.id}
              data-testid={`billing-tier-${tier.id}`}
              style={{
                background: "#ffffff",
                border: "1px solid #adb5bd",
                borderRadius: 6,
                padding: "1rem 1.25rem",
                display: "flex",
                flexDirection: "column",
                gap: "0.5rem",
              }}
            >
              <header>
                <h3
                  style={{
                    margin: 0,
                    fontSize: "1.125rem",
                    fontWeight: 600,
                  }}
                >
                  {tier.name}
                </h3>
                <p
                  data-testid={`billing-tier-${tier.id}-price`}
                  style={{
                    margin: "0.25rem 0",
                    fontSize: "1rem",
                    fontWeight: 600,
                    color: "#1971c2",
                  }}
                >
                  {tier.price}
                </p>
                <p
                  style={{
                    margin: 0,
                    color: "#868e96",
                    fontSize: 13,
                  }}
                >
                  {tier.description}
                </p>
              </header>
              <ul
                style={{
                  margin: 0,
                  padding: 0,
                  listStyle: "none",
                  fontSize: 13,
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.25rem",
                }}
              >
                {tier.features.map((f) => (
                  <li key={f}>· {f}</li>
                ))}
              </ul>
              <div style={{ marginTop: "auto", paddingTop: "0.75rem" }}>
                {tier.upgradeTier && cfg.managed ? (
                  <button
                    type="button"
                    data-testid={`billing-tier-${tier.id}-upgrade`}
                    disabled={!workspaceId || pending !== null}
                    aria-disabled={
                      !workspaceId || pending !== null ? "true" : "false"
                    }
                    title={
                      !workspaceId
                        ? "Pick a workspace first."
                        : pending !== null
                          ? "Already redirecting…"
                          : undefined
                    }
                    onClick={() => handleUpgrade(tier.upgradeTier!)}
                    style={{
                      padding: "6px 12px",
                      border: "1px solid #1971c2",
                      borderRadius: 4,
                      background:
                        pending === tier.upgradeTier ? "#1864ab" : "#1971c2",
                      color: "#ffffff",
                      fontSize: 14,
                      fontWeight: 600,
                      cursor:
                        !workspaceId || pending !== null
                          ? "not-allowed"
                          : "pointer",
                      opacity: !workspaceId ? 0.6 : 1,
                    }}
                  >
                    {pending === tier.upgradeTier
                      ? "Redirecting…"
                      : `Upgrade to ${tier.name}`}
                  </button>
                ) : tier.id === "free" ? (
                  <span
                    data-testid={`billing-tier-${tier.id}-current`}
                    style={{ color: "#868e96", fontSize: 12 }}
                  >
                    Default tier.
                  </span>
                ) : null}
              </div>
            </article>
          ))}
        </div>

        {error && (
          <p
            data-testid="billing-page-error"
            style={{
              marginTop: "1rem",
              color: "#c92a2a",
              fontSize: 13,
            }}
          >
            Checkout failed: {error}
          </p>
        )}
      </div>
    </div>
  );
};
