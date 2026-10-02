// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
//
// The page's content security policy, as the production build writes it
// into index.html (vite.config.ts#cspPlugin).

import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  contentSecurityPolicy,
  inlineScripts,
  styleOrigins,
  withPolicyMeta,
} from "./contentSecurityPolicy";

const STYLES_DIR = resolve(
  __dirname,
  "../../../../packages/basemap/src/styles",
);
const STYLES = readdirSync(STYLES_DIR)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(resolve(STYLES_DIR, f), "utf8")));

function directive(policy: string, name: string): string[] {
  const found = policy
    .split(";")
    .map((d) => d.trim().split(/\s+/))
    .find(([n]) => n === name);
  return found ? found.slice(1) : [];
}

const BASE = { env: {}, styles: STYLES, scripts: [] as string[] };

describe("contentSecurityPolicy", () => {
  it("runs only the page's own scripts: no inline code, no eval, no plugins", () => {
    const policy = contentSecurityPolicy(BASE);
    expect(directive(policy, "script-src")).toEqual([
      "'self'",
      "'wasm-unsafe-eval'",
    ]);
    expect(directive(policy, "object-src")).toEqual(["'none'"]);
    expect(directive(policy, "base-uri")).toEqual(["'self'"]);
    expect(policy).not.toMatch(/'unsafe-eval'|'unsafe-inline'[^;]*script/);
  });

  it("allows an inline script of the page by its hash only", () => {
    const script = "console.log(1)";
    const hash = createHash("sha256").update(script).digest("base64");
    const policy = contentSecurityPolicy({ ...BASE, scripts: [script] });
    expect(directive(policy, "script-src")).toContain(`'sha256-${hash}'`);
  });

  it("connects to every host a built-in basemap style names, and no other", () => {
    const connect = directive(contentSecurityPolicy(BASE), "connect-src");
    for (const origin of styleOrigins(STYLES)) {
      expect(connect).toContain(origin);
    }
    expect(connect).toContain("https://tile.openstreetmap.org");
    // The offline basemaps' glyphs and sprites are the app's own files.
    expect(connect).not.toContain("https://protomaps.github.io");
    expect(connect).not.toContain("https:");
    expect(connect).not.toContain("*");
  });

  it("adds the configured storage, relay and geocoder hosts", () => {
    const connect = directive(
      contentSecurityPolicy({
        ...BASE,
        env: {
          VITE_STORAGE_BASE_URL: "https://store.example.org/api",
          VITE_REALTIME_WS_URL: "wss://relay.example.org",
          VITE_GEOCODER_ENDPOINT: "https://photon.example.org/api",
          VITE_CSP_CONNECT_SRC: "https://tiles.example.net https://a.example",
        },
      }),
      "connect-src",
    );
    expect(connect).toEqual(
      expect.arrayContaining([
        "'self'",
        "https://store.example.org",
        "wss://relay.example.org",
        "https://photon.example.org",
        "https://tiles.example.net",
        "https://a.example",
      ]),
    );
  });

  it("takes a relative storage path as the page's own origin", () => {
    const connect = directive(
      contentSecurityPolicy({
        ...BASE,
        env: { VITE_STORAGE_BASE_URL: "/api" },
      }),
      "connect-src",
    );
    expect(connect.filter((s) => s.includes("/api"))).toEqual([]);
  });

  it("lets MapLibre start its worker from a blob", () => {
    expect(directive(contentSecurityPolicy(BASE), "worker-src")).toEqual([
      "'self'",
      "blob:",
    ]);
  });

  it("refuses an operator entry that is not an origin", () => {
    expect(() =>
      contentSecurityPolicy({
        ...BASE,
        env: { VITE_CSP_CONNECT_SRC: "https://ok.example 'unsafe-eval'" },
      }),
    ).toThrow(/VITE_CSP_CONNECT_SRC/);
  });
});

describe("the page", () => {
  const html = readFileSync(resolve(__dirname, "../../index.html"), "utf8");

  it("finds the inline scripts of index.html: the font path and the boot frame", () => {
    const scripts = inlineScripts(html);
    expect(scripts).toHaveLength(2);
    expect(scripts[0]).toContain("EXCALIDRAW_ASSET_PATH");
    expect(scripts[1]).toContain("data-boot");
  });

  it("puts the policy first in head, before any script runs", () => {
    const out = withPolicyMeta(html, "default-src 'self'");
    const meta = out.indexOf('http-equiv="Content-Security-Policy"');
    expect(meta).toBeGreaterThan(out.indexOf("<head>"));
    expect(meta).toBeLessThan(out.indexOf("<script"));
    expect(meta).toBeLessThan(out.indexOf("<style"));
  });
});
