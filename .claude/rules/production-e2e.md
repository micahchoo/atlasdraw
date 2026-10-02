---
paths:
  - code/apps/atlas-app/playwright.build.config.ts
  - code/apps/atlas-app/e2e-build/**
  - code/apps/atlas-app/src/hooks/useDevHandles.ts
  - code/apps/atlas-app/vite.config.ts
  - .github/workflows/pages.yml
tags: [e2e, playwright, ci, pages]
priority: high
source: hand-written
---

# The production e2e tests what ships

`playwright.build.config.ts` builds one target and serves it as it is
deployed. `E2E_TARGET=pages` builds with exactly the variables of
`pages.yml` and serves `/atlasdraw/` with the Pages 404.html fallback
(`e2e-build/serve-pages.mjs`). `hosted` serves `vite preview` with the real
storage server at `/api` (`PREVIEW_API_PROXY` in `vite.config.ts`).

- **`VITE_E2E_HOOKS=1` is for an e2e build only.** It keeps
  `window.__atlasdraw__` in a production build (`hooks/useDevHandles.ts`).
  Never set it in `pages.yml`, a Dockerfile or a deploy; the Pages smoke
  test asserts the hook is absent, so a Pages build with it fails CI. If
  you change the Pages variables, change both files.
- **Drive the UI, not keys, for tools.** Pressing `r` or `2` on a fresh
  page drew nothing, so `csp.spec.ts` passed its "draws" step without a
  drawing until 2026-10-01. Click the
  toolbar label (`getByTestId("toolbar-<tool>").locator("..")`) and prove a
  drawing by painted pixels on `canvas.excalidraw__canvas.static`.
- **Every smoke test fails on a console error, a failed response, a CSP
  violation, or a request to a host the page's own policy does not name.**
  The one allowed 404 is the Pages deep-link document. Do not widen
  `NOT_OURS` to make a test pass; find the request.
- **Do not edit source while a dev e2e run is live.** The dev server
  reloads the page under the test; 4 of 87 failed that way on 2026-10-01
  and all passed on a quiet tree.

Verify: `npx playwright test --config=playwright.build.config.ts`, then the
same with `E2E_TARGET=pages`. Hosted: 10 passed, 1 skipped (the nginx
header test). Pages: 8 passed, 1 skipped.
