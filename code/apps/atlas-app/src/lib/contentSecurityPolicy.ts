// SPDX-License-Identifier: AGPL-3.0-only
//
// The page's content security policy. The production build writes it into
// index.html as the first element of <head> (vite.config.ts#cspPlugin), so
// every host (nginx, Caddy, Vercel, GitHub Pages, `vite preview`) serves the
// same policy, made from the same configuration as the bundle.
//
// The page holds every map's write key, so a script that runs here can
// rewrite or delete the user's maps. The policy runs only the page's own
// scripts (and its inline boot script, by hash), and the page talks only to
// its own origin and the hosts the build names: the built-in basemaps, the
// configured storage, relay and geocoder, the suggested tile layers, and
// what the operator lists in VITE_CSP_CONNECT_SRC.
//
// A <meta> policy cannot set frame-ancestors. The servers send that header,
// per path: /embed/* may be framed (EMBED_FRAME_ANCESTORS), other pages
// only by the page's own origin. See nginx.conf, infra/caddy/Caddyfile and
// vercel.json.
//
// Pure: the caller reads the files and the environment.

import { createHash } from "node:crypto";

import { SUGGESTED_TILE_LAYERS } from "./tileLayers";

export interface PolicyInputs {
  /** The VITE_* variables of the build. */
  env: Readonly<Record<string, string | undefined>>;
  /** The built-in basemap styles (packages/basemap/src/styles/*.json). */
  styles: readonly unknown[];
  /** The text of each inline script of the page. */
  scripts: readonly string[];
}

/** The origin of the fork's fallback copy of the drawing's fonts. */
const FONT_FALLBACK_ORIGIN = "https://esm.sh";

/** The origin of an absolute URL or URL template, or null. */
function originOf(url: string): string | null {
  try {
    const parsed = new URL(url.replace(/\{[a-z]+\}/gi, "0"));
    return /^(https?|wss?):$/.test(parsed.protocol) ? parsed.origin : null;
  } catch {
    return null;
  }
}

/** The origins a MapLibre style fetches from: tiles, TileJSON, sprite, glyphs. */
export function styleOrigins(styles: readonly unknown[]): string[] {
  const urls: string[] = [];
  for (const style of styles) {
    const s = (style ?? {}) as {
      sources?: Record<string, { tiles?: unknown; url?: unknown }>;
      sprite?: unknown;
      glyphs?: unknown;
    };
    for (const source of Object.values(s.sources ?? {})) {
      if (Array.isArray(source.tiles)) {
        urls.push(
          ...source.tiles.filter((t): t is string => typeof t === "string"),
        );
      }
      if (typeof source.url === "string") {
        urls.push(source.url);
      }
    }
    for (const field of [s.sprite, s.glyphs]) {
      if (typeof field === "string") {
        urls.push(field);
      }
    }
  }
  return unique(urls.map(originOf));
}

function unique(values: ReadonlyArray<string | null>): string[] {
  return Array.from(new Set(values.filter((v): v is string => v !== null)));
}

/** The operator's extra origins; a value that is not an origin is refused. */
function operatorOrigins(list: string | undefined): string[] {
  const entries = (list ?? "").split(/\s+/).filter(Boolean);
  for (const entry of entries) {
    if (originOf(entry) !== entry.replace(/\/$/, "")) {
      throw new Error(
        `VITE_CSP_CONNECT_SRC: "${entry}" is not an origin such as https://tiles.example.org`,
      );
    }
  }
  return entries.map((e) => e.replace(/\/$/, ""));
}

function hashOf(script: string): string {
  return `'sha256-${createHash("sha256").update(script).digest("base64")}'`;
}

/** The policy, as the content of a CSP header or meta element. */
export function contentSecurityPolicy({
  env,
  styles,
  scripts,
}: PolicyInputs): string {
  const remote = unique([
    ...styleOrigins(styles),
    ...SUGGESTED_TILE_LAYERS.map((t) => originOf(t.url)),
    originOf(env.VITE_STORAGE_BASE_URL ?? ""),
    originOf(env.VITE_REALTIME_WS_URL ?? ""),
    originOf(env.VITE_GEOCODER_ENDPOINT ?? ""),
    ...operatorOrigins(env.VITE_CSP_CONNECT_SRC),
  ]);
  const directives: Array<[string, string[]]> = [
    ["default-src", ["'self'"]],
    // WebAssembly (image resize, font subsetting for export) needs
    // 'wasm-unsafe-eval'; it does not allow eval of JavaScript.
    ["script-src", ["'self'", "'wasm-unsafe-eval'", ...scripts.map(hashOf)]],
    // React, Excalidraw and MapLibre set style attributes; index.html has an
    // inline <style> for the boot shell.
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", ["'self'", "data:", "blob:", ...remote]],
    // The fork's font loader lists a CDN copy after the page's own
    // (packages/excalidraw/fonts/ExcalidrawFontFace.ts#createUrls), and
    // Chromium checks every listed source when a FontFace is made. The
    // page's copy loads first; a font cannot run code.
    ["font-src", ["'self'", "data:", FONT_FALLBACK_ORIGIN]],
    ["connect-src", ["'self'", "data:", "blob:", ...remote]],
    // MapLibre starts its worker from a blob URL.
    ["worker-src", ["'self'", "blob:"]],
    ["child-src", ["'self'", "blob:"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
  ];
  return directives
    .map(([name, values]) => `${name} ${values.join(" ")}`)
    .join("; ");
}

/** The text of each inline script (a <script> with no src) of a page. */
export function inlineScripts(html: string): string[] {
  const out: string[] = [];
  const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    if (!/\ssrc\s*=/i.test(m[1] ?? "")) {
      out.push(m[2] ?? "");
    }
  }
  return out;
}

/**
 * The page with the policy in <head>, after the charset and before every
 * script and style. A policy applies only to what the parser meets after it.
 */
export function withPolicyMeta(html: string, policy: string): string {
  const escaped = policy.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  const meta = `<meta http-equiv="Content-Security-Policy" content="${escaped}" />`;
  const charset = /<meta charset=[^>]*>/i;
  return charset.test(html)
    ? html.replace(charset, (m) => `${m}\n    ${meta}`)
    : html.replace(/<head>/i, `<head>\n    ${meta}`);
}
