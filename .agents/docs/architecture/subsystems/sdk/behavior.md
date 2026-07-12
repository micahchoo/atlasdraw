# `packages/sdk` — Behavior

**Status: Speculative.** Predicted post-Phase-7 shape; revise against real code.

**License:** MIT
**Package name:** `@atlasdraw/sdk`

---

## Embed Lifecycle

```
Host page loads
  │
  ├── React path:
  │     <AtlasdrawEmbed src="https://app.atlasdraw.com/embed" onReady={fn} />
  │
  └── Vanilla path:
        const api = await mount(container, { src: "https://app.atlasdraw.com/embed" })
  │
  ▼
AtlasdrawEmbed renders / mount() inserts:
  <iframe src={src} sandbox="allow-scripts allow-same-origin allow-forms" />
  (loading skeleton shown)
  │
  ▼
iframe loads apps/atlas-app editor
  embed-renderer.ts initializes
  editor's onLoad fires
  embed-renderer.ts posts: { type: "event", name: "EMBED_READY" }
  │
  ▼
Host api.ts receives EMBED_READY
  loading skeleton hidden
  onReady(api) called (React) / Promise resolves (vanilla)
  │
  ▼
Consumer code calls api.flyTo(...) / api.addLayer(...) etc.
```

---

## PostMessage Round-Trip Protocol

```
Host → Iframe:
  { type: "command", id: "req-uuid-123", method: "flyTo", args: [{center:[...], zoom:12}] }

Iframe → Host (success):
  { type: "response", id: "req-uuid-123", result: undefined }

Iframe → Host (error):
  { type: "response", id: "req-uuid-123", error: "Invalid bounds" }

Iframe → Host (event):
  { type: "event", name: "sceneChange", payload: { elements: [...] } }
```

The request ID is a `crypto.randomUUID()` (or polyfill). The host maintains a `Map<string, { resolve, reject, timeout }>` of pending requests. On response, the ID is looked up, the timer is cleared, and the Promise is resolved/rejected. After 30 seconds without a response, the Promise rejects with a timeout error and the entry is deleted.
[CONFIDENCE: high — per Phase 6 plan Task 1, ADR 0005]

---

## StructuredClone Safety Enforcement

At the call site in `api.ts`:

```ts
async function callMethod<T>(method: string, args: unknown[]): Promise<T> {
  // Enforce structured-clone safety before any postMessage
  structuredClone(args);  // throws DataCloneError if any arg is non-serializable
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`AtlasdrawAPI.${method} timed out after 30s`));
    }, 30_000);
    pending.set(id, { resolve, reject, timer });
    iframe.contentWindow.postMessage({ type: "command", id, method, args }, targetOrigin);
  });
}
```

If `structuredClone(args)` throws, the consumer receives a synchronous `DataCloneError` before the message is sent — this surfaces misuse immediately rather than silently dropping non-serializable data.
[CONFIDENCE: high — per Phase 6 plan Task 1 Step 1 (structured-clone harness test), Q11]

---

## EMBED_READY State Machine

```
         ┌──────────────┐
         │   LOADING    │  (iframe src set, skeleton shown)
         └──────┬───────┘
                │ EMBED_READY postMessage received
                ▼
         ┌──────────────┐
         │    READY     │  (onReady / Promise resolves, API available)
         └──────┬───────┘
                │ src prop changes OR unmount()
                ▼
         ┌──────────────┐
         │  UNLOADING   │  (pending requests rejected, skeleton reshown)
         └──────┬───────┘
                │ new EMBED_READY (if src changed)
                ▼
             READY (again)
```

---

## Event Subscription Lifecycle

```
api.onSceneChange(handler) → Promise<UnsubscribeHandle>

Internally:
  1. host sends { type:"command", method:"subscribe", args:["sceneChange"] }
  2. iframe responds with subscriptionId
  3. host stores handler in local Map<subscriptionId, handler>
  4. on each sceneChange event from iframe: handler(payload) called

api.onSceneChange(handler).then(handle => handle.unsubscribe())
  1. host sends { type:"command", method:"unsubscribe", args:[subscriptionId] }
  2. iframe stops sending events for that subscriptionId
  3. host deletes handler from Map
```

[CONFIDENCE: med — subscription protocol extrapolated from ADR 0005 pattern]

---

## Focus Management

`<AtlasdrawEmbed>` wraps the iframe in a focus boundary. Per Phase 6 plan codebook `focus-management-across-boundaries`:
- Tab key does not escape the host document into the iframe without explicit user intent.
- The iframe is treated as a focusable group — Tab entering the iframe goes to the first focusable element inside, Tab from the last element inside exits back to the host.
- Implementation: `tabIndex=0` on the wrapper `<div>`, plus `onKeyDown` intercept that redirects Tab-at-boundary back to the host's focus order.

[CONFIDENCE: med — per Phase 6 plan Task 4b codebook citation; exact implementation is engineering judgment]

---

## Endorheic Basins

`api.ts` has one endorheic basin: the `pending` `Map<string, PendingRequest>`. Entries are inserted on every API call and deleted on response or timeout. If the iframe unloads unexpectedly (e.g. parent navigates), all pending entries must be rejected to avoid memory leaks. The `UNLOADING` state transition handles this via an `iframe.onload` / `pagehide` event on the iframe.

---

## Concurrency Model

All API calls are async. Multiple concurrent calls are supported — each has a unique request ID and its own Promise. The host's `pending` map handles arbitrarily many in-flight requests. The iframe's `embed-renderer.ts` processes commands sequentially (JavaScript single-threaded) but responses may arrive out of order relative to issue order.

Consumers should not assume ordering of concurrent calls to different methods (e.g. `setElements` followed immediately by `getElements` may return the pre-`setElements` state if the scene update is async in the editor).
[CONFIDENCE: med — out-of-order response behavior is standard postMessage semantics]
