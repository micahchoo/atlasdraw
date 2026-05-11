import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import fs from "fs";

// atlasdraw-4607 — without this, Vite's SPA fallback returns 200 + index.html
// for missing `/data/*.pmtiles` paths, and MapLibre/pmtiles then fails with
// "Wrong magic number for PMTiles archive". Surface the missing file as a
// real 404 so config errors are obvious instead of cryptic.
const pmtilesNotFoundPlugin = {
  name: "atlasdraw-pmtiles-404",
  configureServer(server: { middlewares: { use: (fn: unknown) => void } }) {
    (server.middlewares.use as (
      fn: (req: { url?: string }, res: {
        statusCode: number;
        setHeader: (k: string, v: string) => void;
        end: (body: string) => void;
      }, next: () => void) => void,
    ) => void)((req, res, next) => {
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

export default defineConfig({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  plugins: [react(), pmtilesNotFoundPlugin] as any,
  server: {
    port: 5174,
    fs: {
      allow: [
        path.resolve(__dirname),
        path.resolve(__dirname, "../.."),
      ],
    },
  },
  resolve: {
    dedupe: ["react", "react-dom", "maplibre-gl"],
    alias: [
      {
        find: /^@excalidraw\/common$/,
        replacement: path.resolve(
          __dirname,
          "../../packages/common/src/index.ts",
        ),
      },
      {
        find: /^@excalidraw\/common\/(.*?)/,
        replacement: path.resolve(__dirname, "../../packages/common/src/$1"),
      },
      {
        find: /^@excalidraw\/element$/,
        replacement: path.resolve(
          __dirname,
          "../../packages/element/src/index.ts",
        ),
      },
      {
        find: /^@excalidraw\/element\/(.*?)/,
        replacement: path.resolve(__dirname, "../../packages/element/src/$1"),
      },
      {
        find: /^@excalidraw\/excalidraw$/,
        replacement: path.resolve(
          __dirname,
          "../../packages/excalidraw/index.tsx",
        ),
      },
      {
        find: /^@excalidraw\/excalidraw\/(.*?)/,
        replacement: path.resolve(__dirname, "../../packages/excalidraw/$1"),
      },
      {
        find: /^@excalidraw\/math$/,
        replacement: path.resolve(
          __dirname,
          "../../packages/math/src/index.ts",
        ),
      },
      {
        find: /^@excalidraw\/math\/(.*?)/,
        replacement: path.resolve(__dirname, "../../packages/math/src/$1"),
      },
      {
        find: /^@excalidraw\/utils$/,
        replacement: path.resolve(
          __dirname,
          "../../packages/utils/src/index.ts",
        ),
      },
      {
        find: /^@excalidraw\/utils\/(.*?)/,
        replacement: path.resolve(__dirname, "../../packages/utils/src/$1"),
      },
    ],
  },
});
