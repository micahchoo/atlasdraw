import { execSync } from "child_process";
import path from "path";
import fs from "fs";
import zlib from "zlib";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// AboutDialog (T14) needs version + build hash. Read from atlas-app's
// package.json and a short git rev at config time; fall back to "unknown"
// if either fails (CI without git history, fresh clones, etc.).
const APP_VERSION = ((): string => {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, "package.json"), "utf8"),
    ) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
})();
const GIT_HASH = ((): string => {
  try {
    return execSync("git rev-parse --short HEAD", {
      cwd: __dirname,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return "unknown";
  }
})();

// atlasdraw-4607 — without this, Vite's SPA fallback returns 200 + index.html
// for missing `/data/*.pmtiles` paths, and MapLibre/pmtiles then fails with
// "Wrong magic number for PMTiles archive". Surface the missing file as a
// real 404 so config errors are obvious instead of cryptic.
const pmtilesNotFoundPlugin = {
  name: "atlasdraw-pmtiles-404",
  configureServer(server: { middlewares: { use: (fn: unknown) => void } }) {
    (
      server.middlewares.use as (
        fn: (
          req: { url?: string },
          res: {
            statusCode: number;
            setHeader: (k: string, v: string) => void;
            end: (body: string) => void;
          },
          next: () => void,
        ) => void,
      ) => void
    )((req, res, next) => {
      if (req.url && /^\/data\/.+\.pmtiles(\?.*)?$/.test(req.url)) {
        const filename = req.url.replace(/\?.*$/, "").slice("/data/".length);
        const fullPath = path.resolve(__dirname, "public", "data", filename);
        if (!fs.existsSync(fullPath)) {
          res.statusCode = 404;
          res.setHeader("Content-Type", "text/plain");
          res.end(
            `PMTiles archive not found: ${req.url}\n` +
              `Set VITE_PMTILES_PATH in code/apps/atlas-app/.env.local or ` +
              `place the archive at apps/atlas-app/public/data/${filename}.`,
          );
          return;
        }
      }
      next();
    });
  },
};

// GH Pages project sites serve from `https://<user>.github.io/<repo>/`. When
// `VITE_BUILD_TARGET=pages`, emit asset URLs under that prefix; otherwise `/`.
// `process.env` here (Node-side config) — not `import.meta.env` (browser-side).
const BUILD_TARGET = process.env.VITE_BUILD_TARGET;
const BASE = BUILD_TARGET === "pages" ? "/atlasdraw/" : "/";

// Local-only archives (e.g. india.pmtiles ~4.9 GB) live in `public/data/`
// for dev convenience but must NOT ship in production builds. Vite's own
// `copyPublicDir` is all-or-nothing — it used to copy the 4.9 GB archive
// into `dist/` only for a prune pass to delete it again (~9 s per local
// build). So the blanket copy is disabled (`build.copyPublicDir: false`
// below) and this plugin places `public/` into `dist/` itself, skipping
// `data/` entries that are not allowlisted.
//
// Everything in this allowlist is a runtime-fetched production asset; a
// `data/` file missing from it never reaches the deployed site. (That is
// how offline geo-search shipped broken: places-index.json was generated,
// fetched by useGeocoderSearch, and silently pruned here.)
const ALLOWED_DATA_FILES = new Set<string>([
  "world-low-zoom.pmtiles",
  "places-index.json",
]);
const copyPublicAssetsPlugin = {
  name: "atlasdraw-copy-public-assets",
  apply: "build" as const,
  closeBundle() {
    const publicDir = path.resolve(__dirname, "public");
    const distDir = path.resolve(__dirname, "dist");
    if (!fs.existsSync(publicDir)) {
      return;
    }
    const copyTree = (src: string, dest: string, isDataDir: boolean): void => {
      for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const from = path.join(src, entry.name);
        const to = path.join(dest, entry.name);
        if (entry.isDirectory()) {
          // Only the top-level `public/data/` is the filtered archive dir.
          copyTree(
            from,
            to,
            isDataDir || (src === publicDir && entry.name === "data"),
          );
          continue;
        }
        if (isDataDir && !ALLOWED_DATA_FILES.has(entry.name)) {
          // eslint-disable-next-line no-console
          console.log(`[atlasdraw] skipped data/${entry.name} (local-only)`);
          continue;
        }
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.copyFileSync(from, to);
      }
    };
    copyTree(publicDir, distDir, false);
  },
};

// Rank 1 of docs/performance/boot-payload-audit.md. The nginx runtime stage
// serves these siblings with `gzip_static on` — a client that reaches nginx
// without Caddy in front used to download the 4.3 MB entry chunk RAW.
//
// gzip only, deliberately. Brotli-11 would save a further ~270 KB on the
// entry chunk, but nothing in this repo can serve a `.br`: nginx:alpine has
// no ngx_brotli, Caddy reverse-proxies rather than serving files, and Vercel
// and GitHub Pages compress on their own and ignore siblings. Emitting `.br`
// today would be building for no consumer. Revisit if static serving moves
// to Caddy's file_server.
//
// Runs in closeBundle AFTER copyPublicAssetsPlugin, so it also catches
// places-index.json. Binary archives never match EXTENSIONS, which is what
// keeps `.pmtiles` uncompressed and therefore still range-requestable.
const PRECOMPRESS_EXTENSIONS = new Set([
  ".js",
  ".css",
  ".html",
  ".svg",
  ".json",
]);
const PRECOMPRESS_MIN_BYTES = 1024;
const precompressPlugin = {
  name: "atlasdraw-precompress",
  apply: "build" as const,
  closeBundle() {
    const distDir = path.resolve(__dirname, "dist");
    if (!fs.existsSync(distDir)) {
      return;
    }
    let files = 0;
    let raw = 0;
    let gz = 0;
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!PRECOMPRESS_EXTENSIONS.has(path.extname(entry.name))) {
          continue;
        }
        const source = fs.readFileSync(full);
        if (source.byteLength < PRECOMPRESS_MIN_BYTES) {
          continue;
        }
        const compressed = zlib.gzipSync(source, { level: 9 });
        // A sibling bigger than the original would make gzip_static a
        // pessimization for that file. Already-compressed payloads hit this.
        if (compressed.byteLength >= source.byteLength) {
          continue;
        }
        fs.writeFileSync(`${full}.gz`, compressed);
        files += 1;
        raw += source.byteLength;
        gz += compressed.byteLength;
      }
    };
    walk(distDir);
    const mb = (n: number): string => (n / 1048576).toFixed(1);
    // eslint-disable-next-line no-console
    console.log(
      `[atlasdraw] precompressed ${String(files)} files: ` +
        `${mb(raw)} MB -> ${mb(gz)} MB gzip`,
    );
  },
};

export default defineConfig({
  base: BASE,
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(APP_VERSION),
    "import.meta.env.VITE_GIT_HASH": JSON.stringify(GIT_HASH),
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  plugins: [
    react(),
    pmtilesNotFoundPlugin,
    copyPublicAssetsPlugin,
    precompressPlugin,
  ] as any,
  build: {
    // See copyPublicAssetsPlugin — selective replacement for the blanket
    // public/ copy that dragged a 4.9 GB local archive through dist/.
    copyPublicDir: false,
  },
  server: {
    port: 5174,
    fs: {
      allow: [path.resolve(__dirname), path.resolve(__dirname, "../..")],
    },
  },
  resolve: {
    dedupe: ["react", "react-dom", "maplibre-gl"],
    alias: [
      {
        find: /^@atlasdraw\/common$/,
        replacement: path.resolve(
          __dirname,
          "../../packages/common/src/index.ts",
        ),
      },
      {
        find: /^@atlasdraw\/common\/(.*?)/,
        replacement: path.resolve(__dirname, "../../packages/common/src/$1"),
      },
      {
        find: /^@atlasdraw\/element$/,
        replacement: path.resolve(
          __dirname,
          "../../packages/element/src/index.ts",
        ),
      },
      {
        find: /^@atlasdraw\/element\/(.*?)/,
        replacement: path.resolve(__dirname, "../../packages/element/src/$1"),
      },
      {
        find: /^@atlasdraw\/excalidraw$/,
        replacement: path.resolve(
          __dirname,
          "../../packages/excalidraw/index.tsx",
        ),
      },
      {
        find: /^@atlasdraw\/excalidraw\/(.*?)/,
        replacement: path.resolve(__dirname, "../../packages/excalidraw/$1"),
      },
      {
        find: /^@atlasdraw\/math$/,
        replacement: path.resolve(
          __dirname,
          "../../packages/math/src/index.ts",
        ),
      },
      {
        find: /^@atlasdraw\/math\/(.*?)/,
        replacement: path.resolve(__dirname, "../../packages/math/src/$1"),
      },
      {
        find: /^@atlasdraw\/utils$/,
        replacement: path.resolve(
          __dirname,
          "../../packages/utils/src/index.ts",
        ),
      },
      {
        find: /^@atlasdraw\/utils\/(.*?)/,
        replacement: path.resolve(__dirname, "../../packages/utils/src/$1"),
      },
    ],
  },
});
