# `packages/sdk` — Contracts

**Status: Speculative.** Predicted post-Phase-7 shape; revise against real code.

**License:** MIT (per Q5)
**Package name:** `@atlasdraw/sdk`

---

## Public Export Surface

---

### `AtlasdrawAPI` interface — **stable**
[CONFIDENCE: high — per Phase 6 plan Task 1, Q11, ADR 0005]

**PostMessage constraint (Q11 / ADR 0005):** All methods are `async` (return `Promise<T>`) or fire-and-forget (`void`). All parameter and return types must pass `structuredClone()` without throwing. No DOM nodes, no class instances, no unserializable values. Unsubscribe handles are `Promise<void>`, not returned functions.

```ts
export interface AtlasdrawAPI {
  // ── Scene ──────────────────────────────────────────────────────────
  /** Get all elements in the current scene */
  getElements(): Promise<SerializedElement[]>;

  /** Replace scene elements */
  setElements(elements: SerializedElement[]): Promise<void>;

  /** Update a single element by ID */
  updateElement(id: string, patch: Partial<SerializedElement>): Promise<void>;

  // ── Viewport ───────────────────────────────────────────────────────
  /** Get current map viewport */
  getViewport(): Promise<{ center: [number, number]; zoom: number; bearing: number; pitch: number }>;

  /** Fly to a location */
  flyTo(opts: { center: [number, number]; zoom?: number; duration?: number }): Promise<void>;

  /** Fit map to a bounding box */
  fitBounds(bounds: [number, number, number, number], opts?: { padding?: number }): Promise<void>;

  // ── Layers ─────────────────────────────────────────────────────────
  /** Get all layer records */
  getLayers(): Promise<SerializedLayerRecord[]>;

  /** Add a GeoJSON data layer */
  addLayer(fc: GeoJSON.FeatureCollection, opts?: { name?: string; style?: SerializedLayerStyle }): Promise<string>;

  /** Remove a layer by ID */
  removeLayer(id: string): Promise<void>;

  // ── Import / Export ────────────────────────────────────────────────
  /** Export current scene as .atlasdraw file blob encoded as base64 */
  exportAtlasdraw(): Promise<string>;  // base64 — Blob is not structured-clone-safe

  /** Export current scene as GeoJSON */
  exportGeoJSON(): Promise<GeoJSON.FeatureCollection>;

  // ── Subscriptions ──────────────────────────────────────────────────
  /** Subscribe to scene changes. Returns a handle; call handle to unsubscribe. */
  onSceneChange(handler: (elements: SerializedElement[]) => void): Promise<UnsubscribeHandle>;

  /** Subscribe to map move events */
  onMove(handler: (viewport: ViewportState) => void): Promise<UnsubscribeHandle>;
}

export interface UnsubscribeHandle {
  unsubscribe(): Promise<void>;
}
```

**Note on `Blob` / `File`:** These types are NOT structured-clone-safe across postMessage boundaries in all environments. `exportAtlasdraw()` returns a base64 string instead of a Blob. Callers decode with `atob()` if they need binary.

[CONFIDENCE: high — per Phase 6 plan Task 1 contracts block, Q11]

---

### Serialized Types (postMessage-safe) — **stable**

```ts
/** Stripped ExcalidrawElement — only structured-clone-safe fields */
export interface SerializedElement {
  id: string;
  type: string;
  x: number; y: number;
  width: number; height: number;
  customData?: {
    geo?: SerializedGeoAnchor;  // GeoAnchor plain object — always structured-clone-safe
    scaleMode?: string;
  };
  [key: string]: unknown;
}

/** GeoAnchor as plain object — matches packages/geo GeoAnchor exactly */
export type SerializedGeoAnchor =
  | { kind: "point"; lng: number; lat: number; zRef: number; projection: "mercator" }
  | { kind: "bbox"; west: number; south: number; east: number; north: number; zRef: number; projection: "mercator" }
  | { kind: "polyline"; coordinates: Array<[number, number]>; zRef: number; projection: "mercator" };

export interface SerializedLayerRecord {
  id: string; name: string; visible: boolean; source: string; styleId?: string;
}

export type SerializedLayerStyle = {
  type: "solid" | "categorical" | "graduated";
  [key: string]: unknown;
};

export interface ViewportState {
  center: [number, number]; zoom: number; bearing: number; pitch: number;
}
```

[CONFIDENCE: high — types are plain objects matching the GeoAnchor spec and passing structuredClone]

---

### `AtlasdrawEmbed` React component — **stable**

```ts
export interface AtlasdrawEmbedProps {
  /** URL of the hosted Atlasdraw editor instance */
  src: string;
  /** Called when the iframe is ready and AtlasdrawAPI is available */
  onReady?: (api: AtlasdrawAPI) => void;
  /** Called on load error (404, network failure) */
  onError?: (err: Error) => void;
  width?: number | string;
  height?: number | string;
  className?: string;
}

export const AtlasdrawEmbed: React.FC<AtlasdrawEmbedProps>;
```

[CONFIDENCE: high — per Phase 6 plan Task 4b]

---

### `mount()` vanilla function — **stable**

```ts
export interface MountOptions {
  src: string;
  width?: number | string;
  height?: number | string;
  onError?: (err: Error) => void;
}

export function mount(
  container: HTMLElement,
  opts: MountOptions
): Promise<AtlasdrawAPI>;

export function unmount(container: HTMLElement): void;
```

[CONFIDENCE: high — per Phase 6 plan Task 4b]

---

## PostMessage Round-Trip Constraints (Q11 / ADR 0005)

1. **All API methods are async.** No sync methods exist on `AtlasdrawAPI`. Every call crosses a postMessage boundary — sync semantics are impossible.
2. **Structured-clone safety is enforced at call time.** `api.ts` wraps every argument in `structuredClone()` before sending. If `structuredClone` throws, the method rejects immediately with a descriptive error.
3. **No DOM nodes, no class instances** in API types. `Blob` is returned as base64 string. `Map`/`Set` must be serialized to array form before passing.
4. **Request IDs** correlate commands to responses. Each call generates a `uuid`-like ID; the response must carry the same ID to resolve the Promise.
5. **Timeout policy:** Promises reject after 30 seconds if no response received. Callers should not assume unlimited wait time.
6. **`EMBED_READY` signal:** The iframe posts `{ type: "event", name: "EMBED_READY" }` after the editor's `onLoad` fires. `onReady` / `mount()` resolve only after this signal.

[CONFIDENCE: high — per Phase 6 plan Task 1 contracts block, Q11, ADR 0005]

---

## Stability Tiers

| Export | Tier | Since |
|--------|------|-------|
| `AtlasdrawAPI` interface | stable | Phase 6 |
| `SerializedElement`, `SerializedGeoAnchor`, `SerializedLayerRecord`, `ViewportState` | stable | Phase 6 |
| `AtlasdrawEmbed` | stable | Phase 6 |
| `mount`, `unmount` | stable | Phase 6 |
| `UnsubscribeHandle` | stable | Phase 6 |

---

## License Notes

`packages/sdk` is MIT-licensed (per Q5). This is the primary consumer-facing integration point — MIT ensures no license friction for commercial embedding. The iframe content it loads (the Atlasdraw editor) remains AGPL; the license split is enforced by the iframe boundary. The SDK itself never includes AGPL code.

**Telemetry:** `packages/sdk` never reports telemetry — zero-telemetry-by-default per decisions/0006-telemetry.md. The SDK has no opt-in heartbeat mechanism.

---

## Backward-Compatibility Policy

`AtlasdrawAPI` is frozen from Phase 6. No method may be removed or have its signature changed in a minor version. New methods may be added. Phase 7 plugin sandbox depends on this interface — it is treated as a published API boundary from Phase 6 onward.
