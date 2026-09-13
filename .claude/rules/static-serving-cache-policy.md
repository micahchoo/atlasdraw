---
scope:
  - code/apps/atlas-app/nginx.conf
  - code/vercel.json
  - code/Dockerfile
  - code/apps/atlas-app/Dockerfile
tags: [performance, caching, deploy]
priority: normal
source: hand-written
---

# One cache policy, four serving surfaces — change one, change the others

atlas-app's `dist` is served by four things that share no config mechanism:

| surface         | config                                   | built by                               |
| --------------- | ---------------------------------------- | -------------------------------------- |
| self-host nginx | `code/apps/atlas-app/nginx.conf`         | `infra/docker-compose.yml`             |
| published image | `code/Dockerfile` (stock nginx, no conf) | `publish-docker.yml`, context `./code` |
| Vercel          | `code/vercel.json`                       | `vercel.json` `buildCommand`           |
| GitHub Pages    | none possible                            | `pages.yml`                            |

The policy is two paired rules, and they are only correct together:

- `/assets/*` → `public, max-age=31536000, immutable` (Vite content-hashes
  these; a new build means a new name).
- `index.html` → `no-cache` (it names those hashed files; a cached document
  outlives the chunks it points at).

Ship one without the other and you get either pointless revalidation or an
app that boots against 404s.

JSON takes no comments, so `vercel.json` cannot carry the reason inline.
`nginx.conf`'s header comment is the canonical statement. If you change a
value, change it in both files and in
`docs/performance/boot-payload-audit.md`.

Two further traps:

- `/assets/` uses `try_files $uri =404`, deliberately **not** the SPA
  fallback. With the fallback, a missing chunk returns `index.html` under a
  `.js` URL and the browser reports a MIME error instead of the real 404.
- `location = /index.html` catches every SPA deep link, not just literal
  requests for `/index.html`, because `try_files`' internal redirect
  re-enters location matching. Don't "fix" it by adding a rule to
  `location /`.

Verify with real nginx, not by reading the conf:

```
docker run -d --name hdr -p 3399:3000 \
  -v "$PWD/nginx.conf:/etc/nginx/conf.d/default.conf:ro" \
  -v "$PWD/dist:/usr/share/nginx/html:ro" nginx:alpine
```

then check `Cache-Control` on `/`, a deep link, a hashed asset, and a missing
asset. The expected table is in the audit doc.

## Precompression

`precompressPlugin` in `apps/atlas-app/vite.config.ts` emits a `.gz` sibling
for every `.js/.css/.html/.svg/.json` over 1 KB; `gzip_static on` serves them.

- **Never add binary extensions to `PRECOMPRESS_EXTENSIONS`.** `.pmtiles` must
  stay uncompressed — MapLibre range-requests it, and `gzip_static` serving a
  whole-file `.gz` would break that.
- Vercel and GitHub Pages ignore siblings and compress on their own. The
  siblings exist for the nginx path only.
