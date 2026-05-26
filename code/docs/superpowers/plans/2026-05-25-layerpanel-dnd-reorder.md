# LayerPanel Drag-and-Drop Reorder

**Date:** 2026-05-25 **Status:** Ready **Phase:** 2 (Tools + Data Layers) — debt resolution **Estimated effort:** ~2 hours

---

## §1 Goal

Replace button-based up/down reorder in LayerPanel.tsx with proper drag-and-drop via @dnd-kit/core, preserving keyboard accessibility and existing features (visibility toggles, expand/collapse, GeoJSON drop zone).

---

## §2 Architecture Context

| File | Role | Change |
| --- | --- | --- |
| `apps/atlas-app/src/components/LayerPanel.tsx` (406 lines) | Renders layer rows with up/down reorder buttons | Replace buttons with @dnd-kit drag handles; add DnD context wrapper |
| `apps/atlas-app/src/state/layerRegistry.ts` | Zustand store with `reorder(id, newOrder)` — no validation, no collision handling | Add order validation, collision resolution, and range clamping |
| `apps/atlas-app/src/components/__tests__/LayerPanel.test.tsx` | Existing tests for visibility, render, GeoJSON drop | Add DnD reorder tests |
| `apps/atlas-app/src/state/__tests__/layerRegistry.test.ts` | Existing tests for store actions | Add reorder validation tests |

**No cross-subsystem coupling.** Self-contained in LayerPanel + layerRegistry. No other components depend on the button reorder API (reorder is called only from LayerPanel.tsx lines 305/314).

**Store contract before (current):**

```ts
reorder: (id: string, newOrder: number) => void
// Sets e.order = newOrder unconditionally. No clamping, no collision resolution.
```

**Store contract after:**

```ts
reorder: (id: string, newOrder: number) => void
// Clamps newOrder to [0, entries.length - 1]. When an entry moves from oldOrder
// to newOrder, all entries between shift by 1 (standard array splice reorder).
```

---

## §3 Tasks

### T1 — Add @dnd-kit/core dependency

**Files:** `apps/atlas-app/package.json` **Steps:**

1. `yarn workspace @atlasdraw/atlas-app add @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities`
2. Verify no peer dependency warnings

**Pass:** `yarn install` exits 0, `@dnd-kit/core` appears in package.json dependencies.

---

### T2 — Fix store `reorder` with validation and collision resolution

**Files:** `apps/atlas-app/src/state/layerRegistry.ts` **Steps:**

1. Replace the current `reorder` implementation (lines 188-194) with a splice-based reorder:
   ```ts
   reorder: (id, newOrder) =>
     set((s) => {
       const clamped = Math.max(0, Math.min(newOrder, s.entries.length - 1));
       const from = s.entries.findIndex((x) => x.id === id);
       if (from === -1) return;
       const [entry] = s.entries.splice(from, 1);
       s.entries.splice(clamped, 0, entry);
       // Re-assign contiguous order indices
       s.entries.forEach((e, i) => { e.order = i; });
     }),
   ```
2. Keep existing `setVisibility`, `updateStyle`, `remove` unchanged.

**Pass:** Unit test: reorder to out-of-bounds clamps; reorder shifts intermediate entries; moving last entry to first works; non-existent id is no-op.

---

### T3 — Wrap LayerPanel rows in @dnd-kit DnD context

**Files:** `apps/atlas-app/src/components/LayerPanel.tsx` **Steps:**

1. Import `DndContext`, `closestCenter`, `KeyboardSensor`, `PointerSensor`, `useSensor`, `useSensors` from `@dnd-kit/core`
2. Import `SortableContext`, `useSortable`, `verticalListSortingStrategy`, `arrayMove` from `@dnd-kit/sortable`
3. Add `useSensors` hook with `PointerSensor` (activationConstraint: distance 8) and `KeyboardSensor`
4. Wrap the row container in `<DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>` + `<SortableContext items={sortedIds} strategy={verticalListSortingStrategy}>`
5. Implement `handleDragEnd`:
   ```ts
   function handleDragEnd(event: DragEndEvent) {
     const { active, over } = event;
     if (over && active.id !== over.id) {
       const oldIndex = sortedIds.indexOf(active.id as string);
       const newIndex = sortedIds.indexOf(over.id as string);
       const newIds = arrayMove(sortedIds, oldIndex, newIndex);
       newIds.forEach((id, i) => mutators.reorder(id, i));
     }
   }
   ```
6. Each row becomes a `<SortableLayerRow>` with a drag handle icon (IconGripVertical or equivalent).

**Pass:** Drag a row to a new position → rows reorder visually and in store. Keyboard: Tab to handle, Space to pick up, ArrowUp/Down to move, Space to drop.

---

### T4 — Create `SortableLayerRow` component with drag handle

**Files:** `apps/atlas-app/src/components/LayerPanel.tsx` **Steps:**

1. Extract a `SortableLayerRow` sub-component using `useSortable`:
   ```tsx
   function SortableLayerRow({ entry, mutators }: RowProps) {
     const {
       attributes,
       listeners,
       setNodeRef,
       transform,
       transition,
       isDragging,
     } = useSortable({ id: entry.id });
     const style = {
       transform: CSS.Transform.toString(transform),
       transition,
       opacity: isDragging ? 0.5 : 1,
     };
     return (
       <div ref={setNodeRef} style={style} {...attributes}>
         <DragHandle listeners={listeners} />
         {/* existing row content: visibility, kind badge, label */}
       </div>
     );
   }
   ```
2. Add `DragHandle` sub-component: `<button {...listeners} aria-label="Drag to reorder"><IconGripVertical /></button>`
3. Remove old up/down chevron buttons (lines 300-317 in current file).
4. Keep `AnnotationLayerRow` and `DataLayerRow` rendering; the `SortableLayerRow` wraps either.

**Pass:** Drag handle is keyboard-accessible (Space to pick up, arrows to move, Space/Escape to drop). aria-label is descriptive.

---

### T5 — Preserve existing features (visibility, expand/collapse, GeoJSON drop)

**Files:** `apps/atlas-app/src/components/LayerPanel.tsx` **Steps:**

1. Verify visibility toggle (IconEye/IconEyeSlash) still works — no changes to onClick handler.
2. Verify data layer expand/collapse (IconChevronDown/IconChevronRight) still works — no changes.
3. Verify GeoJSON drop zone (the empty-state "drop a GeoJSON file" text and the `onDrop` handler) still works — the `<div onDrop={handleGeoJSONDrop}>` wrapper must remain outside the SortableContext but inside the overall DndContext.
4. If GeoJSON drop zone conflicts with DndContext (two drag systems on one element), set `data-no-dnd` attribute on the drop zone and filter in `handleDragEnd`:
   ```ts
   function handleDragEnd(event: DragEndEvent) {
     if (
       event.activatorEvent?.target instanceof HTMLElement &&
       event.activatorEvent.target.closest("[data-no-dnd]")
     )
       return;
     // ... reorder logic
   }
   ```

**Pass:** All existing LayerPanel tests still pass. GeoJSON drop via file browser / drag-from-OS still works.

---

### T6 — Update tests

**Files:** `apps/atlas-app/src/state/__tests__/layerRegistry.test.ts`, `apps/atlas-app/src/components/__tests__/LayerPanel.test.tsx` **Steps:**

1. **Store tests:** Add cases for reorder validation:
   - Reorder to negative clamps to 0
   - Reorder past length clamps to length-1
   - Reorder last entry to position 0 shifts all others up
   - Reorder first entry to last shifts all others down
   - Non-existent id is no-op
2. **Component tests:**
   - Remove tests that assert existence of up/down chevron buttons (data-testid `layer-up-{id}`, `layer-down-{id}`)
   - Add test: drag handle element exists per row (data-testid `layer-drag-{id}`)
   - Test keyboard reorder: Space on handle → ArrowDown → Space drops at new position
   - Test that visibility toggle still works alongside DnD

**Pass:** `yarn vitest run apps/atlas-app/src/state/__tests__/layerRegistry.test.ts apps/atlas-app/src/components/__tests__/LayerPanel.test.tsx` — all tests pass.

---

### T7 — Visual polish

**Files:** `apps/atlas-app/src/styles/LayerPanel.module.css` **Steps:**

1. Add `.dragHandle` style: cursor: grab, padding: 4px, opacity: 0.6 (opacity: 1 on hover/focus)
2. Add `.rowDragging` style: opacity: 0.5, background highlight for the active drag item
3. Add `.dragOverlay` style: slight shadow, scale(1.02) for the floating preview
4. Ensure the drag handle doesn't increase row height (inline-flex, align center)

**Pass:** Visual inspection: drag handles appear as subtle grip icons, cursor changes to grab on hover, dragging shows semi-transparent preview.

---

## §4 Execution Waves

**Wave 1:** T2 (store fix) → foundation for correct state **Wave 2:** T1 (dependency) + T3 (DnD context) + T4 (SortableLayerRow) + T5 (preserve features) — parallel after Wave 1 **Wave 3:** T6 (tests) — after Wave 2 **Wave 4:** T7 (visual polish) — after Wave 3

---

## §5 Open Questions

1. **OQ-1:** Does `@dnd-kit/core` support the required keyboard pattern (Space to pick up, arrows to move) out of the box, or do we need `@dnd-kit/accessibility`? → Default `KeyboardSensor` handles this; only `@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/utilities` needed.

2. **OQ-2:** Does the LayerPanel currently use CSS scroll overflow, and will DnD autoscroll work with it? → Check if the layer panel body has `overflow-y: auto`. @dnd-kit's `PointerSensor` does not auto-scroll by default — if needed, add `@dnd-kit/core`'s `pointerWithin` collision detection and rely on native scroll behavior during drag.

---

## §6 Artifact Manifest

| File | Action | Purpose |
| --- | --- | --- |
| `apps/atlas-app/package.json` | Modify | Add @dnd-kit/core, @dnd-kit/sortable, @dnd-kit/utilities |
| `apps/atlas-app/src/state/layerRegistry.ts` | Modify | Replace reorder with validated splice-based implementation |
| `apps/atlas-app/src/components/LayerPanel.tsx` | Modify | Remove up/down buttons; add DndContext + SortableContext + SortableLayerRow + DragHandle |
| `apps/atlas-app/src/styles/LayerPanel.module.css` | Modify | Add drag handle and dragging state styles |
| `apps/atlas-app/src/state/__tests__/layerRegistry.test.ts` | Modify | Add reorder validation test cases |
| `apps/atlas-app/src/components/__tests__/LayerPanel.test.tsx` | Modify | Replace button tests with DnD tests |

---

## §7 Verification

**Per-wave checks:**

- **Wave 1:** `yarn vitest run apps/atlas-app/src/state/__tests__/layerRegistry.test.ts` — reorder validation tests pass
- **Wave 2:** `yarn workspace @atlasdraw/atlas-app dev` — app starts, LayerPanel renders with drag handles, visibility/exand/collapse/GeoJSON drop still work
- **Wave 3:** `yarn vitest run apps/atlas-app/src/state/__tests__/layerRegistry.test.ts apps/atlas-app/src/components/__tests__/LayerPanel.test.tsx` — all tests pass
- **Wave 4:** Visual: drag handles appear, grab cursor, dragging shows preview, drop reorders

---

## §8 Q-Reference Summary

No prior Q-N decisions constrain this feature. The reorder mechanism is a new UX capability on an existing store action — no architectural decisions modified.
