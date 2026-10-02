// Serve dist/ the way GitHub Pages serves the project site, for the
// production e2e (playwright.build.config.ts, E2E_TARGET=pages).
//
//   node e2e-build/serve-pages.mjs <dist> <port>
//
// - Everything is under /atlasdraw/, as on https://<user>.github.io/atlasdraw/.
// - A path with no file gets 404.html WITH status 404. That is how Pages
//   boots a deep link such as /atlasdraw/m#v2:..., and `vite preview` does
//   not do it (it answers index.html with 200).
// - Range requests get 206: the basemap archive (.pmtiles) is read by range.

import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

const [distArg, portArg] = process.argv.slice(2);
const dist = resolve(distArg ?? "dist");
const port = Number(portArg ?? 5317);
const BASE = "/atlasdraw/";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".pmtiles": "application/octet-stream",
};

function fileFor(pathname) {
  if (!pathname.startsWith(BASE)) {
    return null;
  }
  const rel = normalize(decodeURIComponent(pathname.slice(BASE.length)));
  if (rel.startsWith("..")) {
    return null;
  }
  let file = join(dist, rel);
  if (existsSync(file) && statSync(file).isDirectory()) {
    file = join(file, "index.html");
  }
  return existsSync(file) ? file : null;
}

createServer((req, res) => {
  const { pathname } = new URL(req.url ?? "/", "http://localhost");
  const file = fileFor(pathname);
  if (!file) {
    res.writeHead(404, { "Content-Type": TYPES[".html"] });
    createReadStream(join(dist, "404.html")).pipe(res);
    return;
  }
  const size = statSync(file).size;
  const type = TYPES[extname(file)] ?? "application/octet-stream";
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
  if (range) {
    const start = range[1] ? Number(range[1]) : size - Number(range[2]);
    const end = range[1] && range[2] ? Number(range[2]) : size - 1;
    res.writeHead(206, {
      "Content-Type": type,
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Content-Length": end - start + 1,
      "Accept-Ranges": "bytes",
    });
    createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, {
    "Content-Type": type,
    "Content-Length": size,
    "Accept-Ranges": "bytes",
  });
  createReadStream(file).pipe(res);
}).listen(port, () => {
  // eslint-disable-next-line no-console -- the server says where it listens
  console.log(`pages: ${dist} at http://localhost:${port}${BASE}`);
});
