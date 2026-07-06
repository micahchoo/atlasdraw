# Atlasdraw — Graft Divergences

Generated 2026-07-05, commit `0c42550` (main, 4 ahead of origin/main).
Provenance: graft field-walk over PRD.md, README.md, CHANGELOG.md, tend's
ledgers (JOURNEY, CAPABILITY, HEADROOM, DARKDATA, NEGSPACE, SILENCE, CLAIMS,
COLLABWIRING), docs/superpowers/plans, docs/architecture/adr, and the
atlas-app / storage source. A re-run diffs this file; parked/killed reasons
below are recorded decisions, not re-litigated without new evidence.

graft proposes only what would have to be **built**. Nothing here is built
in this phase. Convergence (a probe that writes code) is additionally gated —
see **Gate** below.

---

## Gate — burning-platform check (SHARED.md)

Checked before proposing growth. **Verdict: not burning — proposing is safe;
code-building convergence is conditionally gated.**

- **Tend issues:** all 9 ISSUES.md Issues `done`; all 5 Directions verdicted
  (2 built, 1 park, 2 reject). No open Strong tend issue.
- **Suite:** green — atlas-app 525, data 144, basemap 76, tools 77, storage
  122 (HANDOFF.md, this-session counts).
- **Security finding:** the one security Issue (workspace isolation, Issue 1)
  is `done` — 2 LOW rows documented + gated, maintainer verdict self-host-only
  (`.claude/rules/managed-mode-tenancy.md`). Accepted boundary, not an open
  red finding.
- **Data-loss risk:** JOURNEY.md closed every silent save/open failure path.
  None open.
- **Caveat (smoldering, not burning):** 52 Dependabot alerts flagged on the
  last push (13 critical / 9 high), untriaged as a delta (HANDOFF.md §Shaky
  ground). The **prior** triage (`docs/security/dependabot-2026-05-11.md`, 25
  alerts) established that Atlasdraw's alerts concentrate in **non-deployed
  vendored surfaces** — `code/dev-docs/`, `code/examples/with-nextjs/`, and
  dev-only test runners (vitest RCE fires only under `--api`, which the config
  never sets); the shippable runtime surface (storage, atlas-app, infra) had
  **zero applicable high/critical**. The 25→52 growth is an unexamined delta,
  not a known runtime breach.

**Convergence gate:** any `thin-slice probe` (code on a branch) waits on two
cheap tend/hygiene clears, both already on HANDOFF.md's Next Steps: (1) a
fresh Dependabot delta re-triage confirming the runtime surface still carries
zero applicable high/critical; (2) `main` pushed (it is 4 commits ahead of
origin, unpushed). A `pr-faq interview` (writes no code) is **not** gated and
can start immediately.

---

## D1 — Read-only map embed: the wedge the v1.0 scope-cut swept out by conflation  ·  ~~TOP BET~~ RE-SCOPE

> **PROBE FINDING (2026-07-05, ledger `ledgers/PROBE-embed.md`).** The
> thin-slice probe **survived its technical kill criterion** — a read-only
> view renders in a genuinely cross-origin iframe (`localhost:5199` framed in
> `127.0.0.1:8137`) with **no postMessage/host handshake**, and nothing the
> app serves blocks framing (no X-Frame-Options/CSP/COOP/COEP; frame-ancestors
> addable in the existing Caddy block). Cross-origin embedding is proven
> feasible. **BUT the probe falsified the "≈90% built / smallest wedge"
> premise below:** `ShareView` is an **annotations-on-white viewer, not a map
> view** — it renders `<Excalidraw viewModeEnabled>` on opaque white
> (`#ffffff`), ignoring `manifest.basemap` + `manifest.camera`, with no
> CoordinateSync (verified in source *and* in-browser: `hasMaplibreElement:
> false`, corner pixel pure white; screenshot `scratchpad/embed-probe.png`). A
> real read-only *map* embed is ShareView **plus the whole MapLibre stack**
> (MapCanvas + basemap resolution + camera + transparent background +
> CoordinateSync + geo-anchor rehydration) — most of MapEditor's hard parts,
> not a chrome-strip. **Verdict: feasible but re-scope + re-rank vs D2.** The
> ~90%/L2-wedge/~2wk claims in the rows below are the *pre-probe* estimate,
> kept for provenance and now known wrong.

**Shape:** feature (thin) + workflow change.
**Vantage:** V1 Job · V2 Workflow · V3 Actors · V4 Operators — **four vantages
converge on one divergence** (the strongest signal this skill produces).

**Evidence**
- *repo* — PRD §4 JTBD #3 ("Present-and-embed… responsive iframe… publish
  without paying per pageview"), §7.2 (embed widget is a **v1.0** line item),
  §8 Flow 3 (Priya "copies the iframe snippet, pastes in her CMS"). §6 names
  the wedge as the empty intersection of (a)–(f), where **(f) = "embeds
  anywhere"** — "The intersection is empty. That's the product."
- *repo* — the embed **did not ship**: README "Out of scope for 1.0 —
  AtlasdrawAPI / SDK / embed widget (`packages/sdk` is a stub)";
  `packages/sdk/src/index.ts` is a literal 5-line stub; CLAIMS.md rows 13/18.
- *repo — the load-bearing nuance* — the cut (`Q-P6-1`,
  `docs/superpowers/plans/2026-05-15-atlasdraw-phase-6-amended-scope.md`)
  targets the **third-party automation API**: "an Embed SDK, AtlasdrawAPI
  postMessage contract… Atlasdraw is only inspired by Felt; it is not a
  Felt-compatible product and does not ship a third-party automation API."
  The heavyweight thing (a frozen public postMessage API surface) was rightly
  cut. The **read-only iframe** of a finished map — a different, much smaller
  thing — was swept out with it by conflation, never separately judged.
- *repo — the wedge is ~90% built* — `ShareView.tsx` already renders a
  chromeless read-only canvas (`<Excalidraw viewModeEnabled initialData={…}/>`
  with not-found/expired/error states); ADR-0008 defines share-link encoding
  (URL-hash ≤32 KB + server-token); `App.tsx` already routes `/m/<token>` and
  `/m#v1:<encoded>` to ShareView with a hand-rolled path detector. An embed is
  ShareView minus the outer app chrome, camera-locked, plus iframe-safe
  response headers and a snippet generator — **no new API, no postMessage, no
  surface freeze.**

**Leverage:** ambition is L3→L4 (completes wedge point (f), turning the tool
from "make a map" into "make and *publish* a map"). But the **wedge is L2/L3
and small**: reuse ShareView behind a new `/embed/<token>` route, add
`frame-ancestors`/CSP so it renders cross-origin, add a 2-line `<iframe>`
snippet to the existing ShareDialog. Blast radius: atlas-app (new route +
ShareDialog addition), a header/CSP change on the served surface. No storage
schema change (server-token share already persists the doc). No new package.

**Who feels it:** Priya, the data journalist (Persona A) — her entire
adoption reason is "embed the final map as a responsive iframe in my CMS…
without paying per pageview." **Today's workaround:** export a static 2× PNG
— the exact "screenshot of QGIS anti-pattern" the PRD rails against (§2, §49)
— or paste a share link that opens the *whole editor chrome*, not an embed.
**Lesson (jobs-to-be-done):** users hire the app for a job that continues past
the last screen; the PNG export is a feature request written in behaviour —
"I needed to publish and you made me screenshot." A scope-cut that conflates a
small closing feature with a large adjacent commitment loses the feature by
accident, not by decision.

**Strength:** **Strong** — two independent repo channels verified this run
(PRD/README scope vs. shipped stub; the cut doc's own rationale showing it
aimed at the API, not the iframe), reinforced by four-vantage agreement and a
named persona.

**Cheapest probe & kill criterion:**
1. *(ungated)* `pr-faq interview` — near-L4 ambition, so the wedge question is
   mandatory (already named: read-only embed ≠ AtlasdrawAPI). Fixes the
   customer (Priya), the announcement, the four risks, and the appetite before
   any code.
2. *(gated — see Gate)* `thin-slice probe` on `probe/embed`, flag `embed_v0`:
   an `/embed/<token>` route rendering ShareView chromeless + camera-locked,
   loaded in a real cross-origin `<iframe>` on a scratch HTML page.
   **Kill criterion (declared now, immovable):** killed if rendering ShareView
   inside a cross-origin iframe *requires* a postMessage/host-API handshake to
   function at all (not merely to be nicer) — that would prove Q-P6-1 was
   right to cut it as one piece; **or** if iframe-embedding can't be made safe
   without response-header control that the `docker compose up` self-host
   story can't provide by default (ADR the trade-off instead of shipping).

**Status:** committed to build → **shipped to `main`** 2026-07-05 (Phases A + A.2). Gate cleared first (`fix/dep-bumps` `193e87d`). `EmbedView` + `/embed` route mount the real MapLibre stack read-only, enabled by default; validated in-browser — chromeless live SF basemap + geo-anchored annotations in a cross-origin iframe, tile-CORS risk retired. Shipped: basemap, camera, annotations, GeoJSON data layers, `?lock=1`, stripped chrome, ShareDialog embed-snippet, `EMBED_FRAME_ANCESTORS` (ADR-0012). Only deferred: scripts-blocked `<noscript>` PNG fallback (needs SSR). Ledgers: `PROBE-embed.md`, `BUILD-embed.md`, spec `PRFAQ.md`.

---

## D2 — Named snapshots / version history: the "version-controlled" the product claims and doesn't have

**Shape:** feature-set.
**Vantage:** V4 Operators (snapshot→history) · V1 Job (continuity).

**Evidence**
- *repo* — PRD §5 **Principle #1**: "Document, not database. A map is a file.
  It is portable, diffable, exportable, and **version-controlled**." This is a
  claim the product makes about *itself* in its own principles.
- *repo* — PRD §7.3 v1.5: "Versioning and history — time-travel slider, named
  snapshots, exportable diff between versions. Particularly valuable for
  journalism (audit trail) and planning (council-meeting versions)."
- *repo* — grep confirms **no user-facing history**: every "snapshot" hit is
  CRDT-internal (yjsChannel, sceneChannel), never a restore/version UI. The
  `.atlasdraw` bundle is diff-friendly by design, but the app exposes nothing.

**Leverage:** L3 (new verbs: snapshot, name, restore, diff). Blast radius:
**medium-large** — needs real persistence of prior states (storage: a
snapshot table + blob refs) plus an atlas-app history panel. Heavier than D1
because it can't be reused from an existing surface the way the embed reuses
ShareView.

**Who feels it:** Persona A (journalism audit trail), Persona B (council
versions). **Today's workaround:** save multiple `.atlasdraw` files by hand
with dated filenames — a hand-carry to the filesystem. **Lesson (jobs-to-be-
done):** a principle the product asserts about itself but doesn't deliver is a
promissory note; "diffable in git by a developer" is not "version history for
a journalist" — the persona who'd use it can't reach it.

**Strength:** **Worth exploring** — one verified channel (repo/PRD). The pull
("audit trail," "council versions") is asserted by the PRD but is
**claim-to-test**: no issue-tracker demand or analytics of users doing the
dated-filename workaround is in reach this run.

**Cheapest probe & kill criterion:** run a `struggling-moment scan` over the
reachable issue tracker / discussions for "history / undo-beyond-session /
version / restore" demand **before** any build. **Kill criterion:** killed if
no user demand for in-app history surfaces *and* the local-first
`.atlasdraw`-in-git path is judged to already satisfy Principle #1's
"diffable/version-controlled" claim (i.e., the principle is met by the format,
not owed as a feature) — in which case the honest fix is a doc line, not a
build, and this hands to tend.

**Status:** queued.

---

## D3 — Field-collection lite: the contributor actor the data implies and no screen serves

**Shape:** feature-set + new actor.
**Vantage:** V3 Actors (the field submitter / volunteer) · V4 Operators
(consume→produce, inbound; private→shared).

**Evidence**
- *repo* — PRD §3 Persona B ("coordinate volunteers"), Persona C (fieldwork
  GPX/CSV/GeoTIFF), §4 secondary JTBD "lightweight field data collection,"
  §7.3 v1.5 "Field collection lite — a mobile-friendly 'submit a point' view
  that lets non-editors drop photo+location entries onto a layer (gated by
  token)." Grep confirms unbuilt.
- *repo — boundary hazard* — a token-gated write path from non-editors rides
  straight into the **deliberately-parked, NOT-tenant-safe** managed-mode /
  auth surface (`.claude/rules/managed-mode-tenancy.md`; memory
  `managed-mode-not-tenant-safe`). The maintainer's posture is self-host-only;
  real multi-tenant contribution "is a build, not a patch."

**Leverage:** L3 (new actor + new verb: contribute-without-edit-rights). Blast
radius: **large** — a new mobile view, a token-scoped write path, a moderation
inbox, and it touches the parked auth boundary. This is a **second system
wearing a divergence's clothes** unless a much smaller wedge is taken.

**Possible wedge (if pursued later):** a single shared "contribution link"
that accepts pin submissions into **one** layer of **one** map on a
**single-tenant self-host** instance — no workspaces, no cross-tenant auth —
sidestepping the parked multi-tenant boundary entirely.

**Who feels it:** field teams (Personas B, C). **Workaround today:** collect
points in a spreadsheet / Google Form and re-import as CSV (a full tool-switch
out and back).

**Strength:** **Speculative** — roadmap-named and operator-fired, no verified
pull in reach; and the obvious shape crosses a boundary the maintainer has
explicitly parked.

**Status:** parked — blast radius + rides the parked managed-mode direction.
Re-open only with (a) evidence of pull (a field-team asking, a form-then-CSV
workaround observed) **and** the single-tenant wedge above scoped so it does
not touch cross-tenant auth.

---

## V5 Policy — honest park (no divergence proposed)

The hardcoded rules a graft V5 audit would lever — per-workspace quota caps
(`middleware/quota.ts`), the free/pro plan split, the three fixed share modes
(private / view-hash / view-token) — are real levers. But the maintainer has
**deliberately parked the entire multi-tenant / managed-mode direction** as
self-host-only, and that surface is explicitly **NOT tenant-safe**
(`.claude/rules/managed-mode-tenancy.md`; the rule's own words: "Real
multi-tenant hosting is a build, not a patch"). Proposing growth that levers
these rules would mean building onto an unenforced trust boundary. **Parked,
cited, not proposed** — this is a recorded decision, not an omission.

## V4 single→batch — none-found (operator fired, principle vetoes)

No list-maps storage route, no gallery/dashboard in atlas-app — a user with
many maps has no home. The single→batch operator fires here. But PRD §5
Principle #1 ("Document, not database") and "Local-first, collab-second"
**actively argue against** a server-side map database/dashboard as the
default shape, and no pull evidence contradicts the principle this run. A
local-first "recent maps" drawer (IndexedDB-backed, zero server) is a
conceivable tiny Speculative wedge, but with no evidence of the struggle it
would serve, it stays **none-found with reason**, not a divergence.

---

## Top bet

**D1 — the read-only map embed.** Governed by the gate (not burning;
`pr-faq interview` ungated, `thin-slice probe` gated on Dependabot delta
re-triage + push). It ranks first on every axis: highest leverage (completes
the product's own stated wedge point (f)), yet the **smallest wedge** of the
three (reuses ShareView + share-link + routing already on disk — no new
package, no schema change), the only **Strong** row, and the only one where
four vantages independently point at the same build. It is not a
claim-only divergence and its L4 ambition already carries a named L2/L3 wedge
(read-only iframe ≠ AtlasdrawAPI), so it clears the SHARED.md gate on the Top
bet. D2 (version history) is the next bet but rests on a claim-to-test that a
struggling-moment scan should confirm before any build; D3 (field collection)
is parked behind both a pull test and a boundary it must not cross.
