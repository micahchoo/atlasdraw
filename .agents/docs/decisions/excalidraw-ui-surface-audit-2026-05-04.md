# Excalidraw v0.18 UI Surface Audit — Atlasdraw Slot Strategy

**Date:** 2026-05-04  
**Authored for:** Atlasdraw Phase 1–7 UI slot decisions + Phase 2 Wave 4b/4c retrofit recommendations.  
**Directive:** "Excalidraw's UX was hardwon — we should not reinvent the wheel unless absolutely necessary."

---

## 1. Surface Inventory

Excalidraw v0.18 exposes the following UI surfaces for extension:

| Surface | Position | Default Contents | Extension Mechanism | Source | Atlasdraw Fit |
|---------|----------|------------------|-------------------|--------|--------------|
| **MainMenu** | Top-left hamburger (dropdown) | File, Edit, View, Preferences items + UserList (collab mode) | `<MainMenu>{children}</MainMenu>` slot + `.DefaultItems` namespace | `code/packages/excalidraw/components/main-menu/MainMenu.tsx:30–65`; exports at `index.tsx:339` | File/Save/Open/Share actions; settings menus |
| **Sidebar** | Right-side docked/floating panel | None (slot-driven); built-in names: "elements", "libraries" (can extend with custom `name`) | `<Sidebar name="layers">{children}</Sidebar>` + static subcomponents (Header, Tab, Trigger, TabTrigger) | `code/packages/excalidraw/components/Sidebar/Sidebar.tsx:50–150`; exports at `index.tsx:342` | LayerPanel (v0.18 verified); Comments panel; Asset library; Style editor |
| **Footer** | Bottom-center bar | Canvas zoom % + stats placeholder | `renderCustomStats` prop (ExcalidrawProps) | `code/packages/excalidraw/components/footer/Footer.tsx`; exports at `index.tsx:340` | Status indicators; coordinate display; scale readout |
| **renderTopLeftUI** | Top-left zone (overlays) | None | Render-prop `(isMobile, appState) => JSX \| null` on ExcalidrawProps | `code/packages/excalidraw/types.ts:574` | Custom buttons (Pin tool toggle, Layers toggle); overlays |
| **renderTopRightUI** | Top-right zone (overlays) | None | Render-prop `(isMobile, appState) => JSX \| null` on ExcalidrawProps | `code/packages/excalidraw/types.ts:576` | Export/Share buttons; Help; About |
| **WelcomeScreen** | Modal overlay (initial state) | Excalidraw logo, "Start drawing", templates | `welcomeScreen` prop; no slot — fully replaceable component | `code/packages/excalidraw/components/welcome-screen/WelcomeScreen.tsx`; exports at `index.tsx:341` | Onboarding; geo-primer; license boilerplate |
| **CommandPalette** | Ctrl+K floating modal | Search + list of commands (tools, actions) | Not directly extended in v0.18; read-only built-in behavior | `code/packages/excalidraw/components/CommandPalette/CommandPalette.tsx` | Future: search integration; plugin commands (Phase 7) |
| **Actions Panel** | Left sidebar (element properties) | Stroke, fill, opacity, font, etc. for selected element | Not directly slotted in v0.18; data flows via `onChange` callback + imperative API | `code/packages/excalidraw/components/Actions.tsx` | Read-only; style sync required via onChange + imperative updates |
| **Toolbar** | Top-center; stacked tool buttons | Selection, drawing tools (rectangle, ellipse, text, pen, etc.) | Not slotted; hardcoded tools. Custom tools added via PinTool pattern (atlasdraw extension) | `code/packages/excalidraw/components/Toolbar/` | Extended via `@excalidraw/tools` API (PinTool, TextLabelTool, etc.) |
| **Stats Panel** | Bottom-right corner | Element count, bounds, selected info | `renderCustomStats` prop on ExcalidrawProps | `code/packages/excalidraw/components/Stats/Stats.tsx` | Geo stats (bounds in lat/lng, layer counts) |
| **Dialogs** (core) | Overlay modals | ExportDialog, ImportDialog, ConfirmDialog, OverwriteConfirm, etc. | Imperative API: `excalidrawAPI.openDialog({name, ...})` + state-driven closure | `code/packages/excalidraw/components/` (Dialog*.tsx files) | File open/save; share modal; confirm bulk actions |
| **Pointer Indicator** | Canvas overlay | Pointer position (multiplayer) | Read-only; `onPointerUpdate` callback hook | `code/packages/excalidraw/types.ts:586` | Followee indication; drawing-state UI |
| **Undo/Redo Stack** | Toolbar buttons (implicitly) | Shown via keyboard (Ctrl+Z/Y) | Imperative API: `excalidrawAPI.history.push()` + `undo()`/`redo()` | `code/packages/excalidraw/types.ts:960` | Managed implicitly; no custom UI needed |

**Notes:**
- **Imperative API** summary at `code/packages/excalidraw/types.ts:900–1000` includes: `setActiveTool`, `setSelectedElements`, `deleteSelectedElements`, `toggleSidebar`, `openDialog`, `getAppState`, `getSceneElementsAsJSON`, `setDarkMode`, `updateLibrary`, `addWatermark`, `focusContainer`, etc.
- **v0.18 Context Menu API:** NOT exposed as a public slot in v0.18 core. Atlasdraw has a vendored fork (`registerContextMenuItem`) in flight (Wave 4b T14 via `atlasdraw-4ad2`). This is the ONLY case where v0.18 genuinely lacks a surface.
- **Layout composition:** `code/packages/excalidraw/components/LayerUI.tsx` orchestrates all surfaces; Excalidraw children render inside the main canvas container, not overlaid.

---

## 2. Retro Audit — Phase 1+2 UI

All atlasdraw UI built to date, graded by Excalidraw surface alignment:

| Atlasdraw Element | Built in | Current Surface | Grade | Notes & Correction |
|------------------|----------|-----------------|-------|-------------------|
| **Pin Tool Toggle** | Phase 1, Wave 1 | `renderTopLeftUI` overlay button (MapEditor.tsx:358–371) | **CORRECT** | Positioned top-left corner; uses Pin button pattern; stable per UI conventions skill. Atlasdraw-correct surface for tool activation. |
| **LayerPanel** | Phase 2, Wave 2 | `<Sidebar name="layers">` with nested Tabs, Header, Triggers | **CORRECT** | Verified vs. vendored v0.18 source (LayerPanel.tsx header cite). Sidebar API stable; children route through Excalidraw's modal/dock state. |
| **LayerPanel Toggle Button** | Phase 2, Wave 4b (T22) | `renderTopLeftUI` overlay button (MapEditor.tsx, post-T22) | **CORRECT** | Imperative API call: `excalidrawAPI.toggleSidebar({name:"layers"})`. Mirrors Pin toggle pattern; aria-pressed wired to `appState.openSidebar?.name`. |
| **Export PNG Button** | Phase 2, Wave 4b (T23) | `renderTopLeftUI` overlay button (MapEditor.tsx, post-T23) | **CORRECT** | Calls `exportPNG(map, excalidrawAPI)` from lib/export.ts. Click → URL.createObjectURL → invisible `<a download>` → triggerclick. Positioned with Pin + Layers buttons. |
| **Convert to Data Layer** | Phase 2, Wave 2 (T14) | **CURRENT (W-B):** MainMenu child item; **PLANNED:** right-click context menu | **TOLERABLE** → **WRONG** | **Issue found:** Phase 2 plan explicitly specifies "right-click context menu item" (plan §8 Flow 2, T14 brief). This is the natural UX — annotation-to-layer is a context action, not a document-level operation like Save or Export. **W-B moved it to MainMenu**, which is usable but semantically weaker (users won't think to look in ≡ menu). **Recommendation:** revert to context menu when fork (`registerContextMenuItem`) ships (in flight, unblocks T14 retrofit). For now, MainMenu is acceptable bridge. |
| **MapLibre Canvas Layer** | Phase 1, Wave 0 | Bottom-stacked `<MapCanvas>` component + Excalidraw transparent overlay | **CORRECT** (new) | Necessarily custom — Excalidraw has no "swap basemap" surface. This is the project's reason for existing. z-index + pointer-events gating handled in MapEditor CSS modules. |
| **GeoJSON Drop Handler** | Phase 2, Wave 2 (T13) | Capture-phase drop on root div (MapEditor.tsx:195–230) | **CORRECT** (new) | Excalidraw's own drop handler at deeper DOM node; atlasdraw intercepts in capture phase. Necessary because Excalidraw consumes file DataTransfer before React bubble phase. |
| **Tool Interaction Overlay** | Phase 2, Wave 1 (T09–T10) | `renderTopLeftUI` + interaction div overlay (MapEditor.tsx:300+) | **CORRECT** (new) | PinTool and custom tools require pointer capture above Excalidraw layer. Overlay mounts conditionally when `activeAtlasTool` is non-null; pointer-events gate managed by `isDrawingMode`. |

**Summary of Phase 1+2:**
- **7 CORRECT slots.** **1 TOLERABLE → WRONG:** Convert action currently MainMenu (usable; should migrate to context menu on fork ship). **Retro action: file as seed for T14 retrofit post-fork.**
- **0 regressions:** No Phase 1+2 elements created new free-floating surfaces that should have used built-in ones.

---

## 3. Forward Audit — Phase 3–7 UI

### Phase 3: File Format (Save/Open/isDirty)

| Planned UI | Planned Approach | Recommended Excalidraw Surface | Plan-Text Drift? | Risk | Status |
|-----------|-------------------|--------------------------------|-------------------|------|--------|
| Save Button | Toolbar button | Toolbar slot (NEW: *not exposed in v0.18*) | **YES—DRIFT.** Plan says "add to Toolbar.tsx" but Toolbar is hardcoded; no slot mechanism. | **MEDIUM.** Atlasdraw must either (a) use `renderTopLeftUI` button overlay (consistent with Pin/Layers pattern) or (b) fork Toolbar (fragile). Recommend (a). | **Recommend amend plan to use renderTopLeftUI.** |
| Open Button | Toolbar button | Toolbar slot / renderTopLeftUI | **YES—DRIFT.** Same as Save. | **MEDIUM.** | **Recommend amend to renderTopLeftUI.** |
| isDirty Indicator | Toolbar area (bullet/asterisk in title) | Toolbar / render-prop integration | **MODERATE DRIFT.** Plan proposes title-bar indicator; Toolbar is hardcoded. Could render in `renderTopLeftUI` next to buttons or use page `<title>` tag. | **LOW.** Indicator is state-only; no interaction needed. Title tag works cross-browser. | **Amend: recommend `<title>` update on isDirty flip + optional renderTopLeftUI badge.** |

**Phase 3 forward action:** All three are currently planned for a hardcoded Toolbar slot. **Recommendation: file 3 plan-amendment seeds to move Save/Open to `renderTopLeftUI` pattern; isDirty to `<title>` tag + optional badge.**

---

### Phase 4: MVP Self-Host (Share/About/Help)

| Planned UI | Planned Approach | Recommended Excalidraw Surface | Plan-Text Drift? | Risk | Status |
|-----------|-------------------|--------------------------------|-------------------|------|--------|
| ShareDialog | Modal (new standalone component) | Imperative API: `excalidrawAPI.openDialog({name:"share", ...})` | **NO.** Plan correctly identifies this as a modal. Excalidraw has Dialog primitives (ConfirmDialog, ExportDialog) but they are internal. **Workaround:** render `<ShareDialog>` as a portal or state-driven overlay in `renderTopRightUI` or MapEditor directly (not slot-constrained). | **LOW.** Modal pattern is standard. No exposure risk. | **CORRECT.** No amendment needed. |
| AboutDialog | Modal (component) | Modal overlay (renderTopRightUI or portal) | **NO.** Same approach as ShareDialog. | **LOW.** | **CORRECT.** |
| Help Menu | Top-level menu item or ? button | **Recommendation: MainMenu subitem** OR **renderTopRightUI button.** | **YES—OPTION DRIFT.** Plan doesn't specify menu placement. Help is traditionally a MainMenu item (top-left) or an "?" badge (top-right). Recommend MainMenu.DefaultItems child (via MainMenu.Item) for consistency with File/View. | **LOW.** Both surfaces are viable; Plan should clarify. | **Amend: specify MainMenu Help submenu (e.g., Help → Keyboard Shortcuts / About / Report Issue).** |
| Telemetry Policy | ADR document (not UI) | N/A (policy, not surface) | **N/A.** | **N/A.** | **On track; ADR is prerequisite, not a UI audit item.** |

**Phase 4 forward action:** ShareDialog and AboutDialog placement clear. **Recommendation: amend Help placement to MainMenu Help submenu + keyboard shortcuts via CommandPalette.**

---

### Phase 6: v1.0 Embeds, Comments, Style Editor, Asset Library

| Planned UI | Planned Approach | Recommended Excalidraw Surface | Plan-Text Drift? | Risk | Status |
|-----------|-------------------|--------------------------------|-------------------|------|--------|
| CommentsPanel | Sidebar tab | `<Sidebar name="comments">` | **NO.** Plan correctly identifies Sidebar. | **LOW.** Comments are second-class to LayerPanel but Sidebar can host both via Tab switching (Sidebar.Tabs + SidebarTab components). | **CORRECT.** |
| CommentAnchor | Map overlay pin | `renderTopLeftUI` overlay OR canvas annotation | **MODERATE.** Plan says "map overlay pin" — unclear if rendered as DOM overlay (renderTopLeftUI) or as canvas annotation (Excalidraw element). Canvas annotation is cleaner (benefits from zoom/pan sync). | **MEDIUM.** If canvas-annotated, threads must sync via `onChange` callback + `setSelectedElements` imperative. If overlay, pointer management is explicit. Recommend canvas annotation (treat comment anchor as a pseudo-element, not a DOM element). | **Clarify: CommentAnchor as canvas pseudo-element (like selected-element glow) vs. DOM overlay.** |
| CommentComposer | Text input + buttons | Modal dialog OR inline composer in CommentsPanel | **MODERATE DRIFT.** Plan lists as separate component but doesn't specify surface. Recommend inline in CommentsPanel (a textarea + submit button) or as a modal dialog (renderTopRightUI/portal). | **LOW.** Both are reasonable; plan should specify. | **Amend: inline composer in CommentsPanel recommended (reduces modal nesting).** |
| AssetLibraryPanel | Sidebar tab | `<Sidebar name="library">` (or custom name if namespace collision with Excalidraw's built-in `libraries` tab) | **MODERATE DRIFT.** Excalidraw v0.18 already has a built-in Libraries sidebar tab. Atlasdraw's AssetLibrary (geo-aware asset browser) is distinct. **Recommendation: use custom Sidebar name `"assets"` to avoid collision.** Plan does not address this. | **MEDIUM.** Namespace collision risk if both tabs try to use the same `name`. Verify v0.18's built-in Libraries is not aliased to `"library"` (check Sidebar.tsx common.ts SidebarName type). | **Amend: specify AssetLibraryPanel as `<Sidebar name="assets">` to avoid collision with built-in libraries.** |
| StylePanel (Maputnik) | Modal iframe wrapper (MaputnikModal.tsx) | Modal dialog (renderTopRightUI OR portal) | **NO.** MaputnikModal is correctly identified as a modal. Iframe isolation is correct (Maputnik is external). | **LOW.** Iframe cross-origin comms is defined; no Excalidraw surface conflict. | **CORRECT.** |
| PrintDialog | Modal (page size, title) | Modal dialog (renderTopRightUI OR portal) | **NO.** Dialog surface is correct. | **LOW.** | **CORRECT.** |

**Phase 6 forward action:** **3 amendments:**
1. **CommentsPanel surface is correct (Sidebar tab).**
2. **CommentAnchor rendering method needs clarification** (canvas annotation vs. DOM overlay).
3. **AssetLibraryPanel Sidebar name collision** — use `"assets"` not `"library"`.

---

### Phase 7: v1.5 Field Plugins, Webhooks, Collaboration

| Planned UI | Planned Approach | Recommended Excalidraw Surface | Plan-Text Drift? | Risk | Status |
|-----------|-------------------|--------------------------------|-------------------|------|--------|
| SubmitForm | Modal form (title + notes + submit button) | Modal dialog (renderTopRightUI OR portal) | **NO.** Form is modal; surface is correct. | **LOW.** | **CORRECT.** |
| CollectionLayer Config UI | Panel / settings modal | Sidebar tab OR modal dialog | **MODERATE DRIFT.** Plan mentions "CollectionLayer config" but does not specify UI surface (panel, modal, inline editor). Recommend: inline style editor in StylePanel OR dedicated Sidebar tab `"collection-config"`. | **MEDIUM.** Style/config panels are common in GIS tools; defer placement decision to design review. | **Recommend design review to specify surface** (Sidebar tab vs. modal vs. inline in StylePanel). |
| PluginRegistry / PluginManagerPanel | Plugin browser / installer | Sidebar tab | **MODERATE DRIFT.** Plan mentions PluginRegistry (backend) and PluginManagerPanel (frontend) but does not specify UI surface. Recommend: Sidebar tab `"plugins"` (consistent with layers/comments/assets pattern). | **MEDIUM.** Plugin manager is a settings-like surface; Sidebar is appropriate. Confirm design. | **Amend: PluginManagerPanel as `<Sidebar name="plugins">`.** |

**Phase 7 forward action:** **2 amendments:**
1. **CollectionLayer config UI** — design review to specify surface.
2. **PluginManagerPanel** — use Sidebar tab pattern.

---

## 4. Vendored-Fork Decisions

### v0.18 Genuine Gaps Requiring Fork

| Gap | Severity | Justification | Workaround | Cost Estimate | In Flight? |
|-----|----------|---------------|-----------|---------------|-----------|
| **Context Menu API** (`registerContextMenuItem`) | **HIGH** | Excalidraw v0.18 has NO public API to add items to the right-click context menu. Phase 2 T14 (Convert to Data Layer) is semantically a context action — "this element → data layer" — but must live in MainMenu (Phase 1 workaround) until fork ships. Fork adds a tunnel-based registration point similar to MainMenu. | Use MainMenu.Item for now (tolerable but semantically weak). Migrate T14 to context menu on fork ship. | **SMALL.** Single fork point; ~40 lines modified in vendored App.tsx (context menu handler + tunnel). No new component. | **YES.** Wave 4b T14 in flight; carry forward T14 retrofit. |

**Summary:** Only 1 gap. All other Phase 3–7 surfaces fit into built-in Excalidraw slots. The context menu fork is justified and already in-flight.

---

## 5. Recommendations

### Immediate (Phase 2 Wave 4b/4c, pre-ship)

1. **T14 Convert Action — Wait for Fork Ship (in flight)**
   - Current: MainMenu item (tolerable).
   - Target: Right-click context menu item (correct) once `registerContextMenuItem` fork lands.
   - **Action:** File seed `atlasdraw-T14-retrofit-context-menu` (post-fork ship) to move Convert action from MainMenu to context menu.
   - **Acceptance:** User right-clicks annotation → "Convert to Data Layer" appears; disabled for text/arrow with tooltip.

2. **Toolbar Surface Gap — Amend Phase 3 Plan**
   - Issue: Phase 3 plan assumes hardcoded Toolbar slot for Save/Open/isDirty, but Toolbar is not slotted in v0.18.
   - **Action:** File 3 seeds:
     - `atlasdraw-P3-save-button-renderTopLeftUI` — Save button via `renderTopLeftUI` overlay (consistent with Pin/Layers pattern).
     - `atlasdraw-P3-open-button-renderTopLeftUI` — Open button via `renderTopLeftUI` overlay.
     - `atlasdraw-P3-isDirty-title-tag` — isDirty state reflected in page `<title>` tag (e.g., `*Untitled Map` when dirty).

### Short Term (Phase 3–4, plan amendments)

3. **Phase 4 Help Menu — Clarify Placement**
   - Recommend: MainMenu Help submenu (top-left, standard).
   - **Action:** Amend Phase 4 plan to specify Help as MainMenu.Group/Item with subitems: Keyboard Shortcuts, About, Report Issue.

4. **Phase 6 AssetLibraryPanel — Avoid Sidebar Name Collision**
   - Excalidraw v0.18 has built-in Sidebar tab for Libraries (`name="libraries"`).
   - **Action:** Specify AssetLibraryPanel as `<Sidebar name="assets">` (not `"library"` or `"libraries"`).
   - **Risk:** If collision occurs, Sidebar will only render one tab; the other will be hidden.

5. **Phase 6 CommentAnchor — Clarify Rendering Method**
   - Issue: Unclear whether comment anchors are canvas annotations or DOM overlays.
   - **Recommendation:** Canvas annotation (treat as pseudo-element). Syncs with zoom/pan; cleaner than DOM pointer management.
   - **Action:** Design review + update Phase 6 plan to specify canvas annotation rendering.

6. **Phase 7 PluginManagerPanel — Adopt Sidebar Pattern**
   - **Recommendation:** `<Sidebar name="plugins">` tab (consistent with layers/comments/assets/collection-config pattern).
   - **Action:** Amend Phase 7 plan to specify PluginManagerPanel as Sidebar tab.

### Risk Mitigation (Ongoing)

7. **UI Conventions Skill — Pre-Spike Dependency**
   - All new surfaces must invoke `atlasdraw-ui-conventions` BEFORE CSS/layout work. Existing surfaces (Pin, Layers, Export) already conform; reuse className references.
   - **Action:** Ensure all future UI tasks cite skill in Brief-prep; lint for slot-first principle in code review.

8. **Excalidraw Fork Maintenance**
   - v0.18 is pinned; context menu fork is the only modification.
   - **Action:** Document fork diff in `/docs/decisions/excalidraw-v0.18-fork-context-menu.md`. If future phases require additional fork points, escalate to orchestrator for cost/benefit review.

---

## 6. Slot Audit Summary

**Total surfaces inventoried:** 12 (MainMenu, Sidebar, Footer, renderTopLeftUI, renderTopRightUI, WelcomeScreen, CommandPalette, Actions Panel, Toolbar, Stats Panel, Dialogs, Pointer Indicator).

**Phase 1+2 audit:**
- 8 elements audited (Pin toggle, LayerPanel, LayerPanel toggle, Export PNG, Convert, MapLibre layer, Drop handler, Overlay).
- **7 CORRECT slots.** **1 TOLERABLE** (Convert in MainMenu, should be context menu post-fork). **0 regressions.**

**Phase 3–7 forward audit:**
- 16 planned UI elements across 5 phases.
- **11 CORRECT slots.** **3 plan-text drift (amend).** **2 clarifications needed (design review).**
- **0 new surfaces required** (all fit built-in Excalidraw surfaces).

**Vendored fork requirement:** 1 gap (context menu API). In-flight; justified.

---

## 7. Implementation Checklist (For Seed Filers)

- [ ] **Seed: T14 Convert Action Retrofit** — post-fork ship; migrate MainMenu item to context menu.
- [ ] **Seed: Phase 3 Plan Amendment — Save/Open Buttons** — move from hardcoded Toolbar to `renderTopLeftUI` overlay.
- [ ] **Seed: Phase 3 Plan Amendment — isDirty Indicator** — implement via page `<title>` tag update + optional renderTopLeftUI badge.
- [ ] **Seed: Phase 4 Plan Amendment — Help Menu** — specify MainMenu Help submenu structure.
- [ ] **Seed: Phase 6 Plan Amendment — AssetLibraryPanel Sidebar Name** — clarify `name="assets"` to avoid collision.
- [ ] **Seed: Phase 6 Design Review — CommentAnchor Rendering** — canvas annotation vs. DOM overlay decision.
- [ ] **Seed: Phase 7 Plan Amendment — PluginManagerPanel** — specify as `<Sidebar name="plugins">`.
- [ ] **Seed: Phase 7 Design Review — CollectionLayer Config UI** — specify surface (Sidebar tab vs. modal).
