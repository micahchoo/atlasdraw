// @atlasdraw/storage — Phase 4 T1: storage contract types.
//
// Defined first (Wave 0) so Wave 1 implementations (T3 server, T8/T9 share
// clients, T13 atlas-app autosave wiring) can build against a stable
// interface rather than a moving target. No runtime code — types only.

/**
 * Selects which adapter the storage server loads at startup.
 * - `postgres-minio`: full stack (Postgres for metadata, MinIO/S3 for blobs).
 * - `sqlite-fs`: minimal stack (SQLite for metadata, filesystem for blobs).
 */
export type StorageMode = "postgres-minio" | "sqlite-fs";

/**
 * A persisted map document. `blob_ref` is the adapter-specific location of
 * the underlying scene+state JSON blob — an S3 key for postgres-minio, a
 * relative filesystem path for sqlite-fs.
 *
 * Phase 6 A9: `workspace_id` is optional metadata. Phase 4 records and
 * self-host records persist as `null`. Hosted-mode creates carry the
 * requesting workspace value. Retrieval is workspace-agnostic in Wave 1
 * — DB-backed scoping enforcement comes in Wave 3 A13b.
 */
export interface MapRecord {
  id: string;
  created_at: string;
  updated_at: string;
  blob_ref: string;
  byte_size: number;
  workspace_id?: string | null;
}

/**
 * A read-only share token. `mode: 'read'` is the only mode in Phase 4;
 * write tokens are deferred to Phase 6.
 *
 * Phase 6 A9: `workspace_id` is optional metadata on the token, scoping
 * the token to the workspace that minted it. Phase 4 / self-host tokens
 * persist as `null`. Retrieval enforcement comes in Wave 3 A13b.
 */
export interface ShareToken {
  token: string;
  map_id: string;
  mode: "read";
  expires_at: string;
  created_at: string;
  workspace_id?: string | null;
}

/**
 * Optional per-call workspace scope passed by the route layer to the
 * adapter. Phase 6 A9: adapters MUST persist the value when present and
 * leave it `null` when absent — they MUST NOT reject calls based on it
 * (Wave 1 keeps retrieval workspace-agnostic).
 */
export interface WorkspaceScope {
  workspaceId?: string | null;
}

/**
 * Workspace plan tier. Phase 6 A13b/A13c:
 *  - `free` — default tier; map count gated by `QUOTA_FREE_MAPS`.
 *  - `pro`  — paid tier; map count gated by `QUOTA_PRO_MAPS`.
 *
 * A third tier, `pro_25` ("Pro+"), previously existed here with its own
 * Stripe price ID but an identical map cap to `pro` — no code anywhere
 * ever read a difference between the two. Folded back into `pro` per
 * ISSUES.md Direction 5 (headroom audit verdict: reject).
 */
export type WorkspacePlan = "free" | "pro";

/**
 * A persisted workspace. `stripe_customer_id` is `null` for free-tier
 * workspaces that haven't gone through Stripe checkout yet.
 */
export interface Workspace {
  id: string;
  name: string;
  plan: WorkspacePlan;
  stripe_customer_id: string | null;
  created_at: string;
}

/**
 * Storage adapter contract. Both `postgres-minio` and `sqlite-fs` adapters
 * implement this; atlas-app consumes it through the HTTP layer (T3) and
 * never touches an adapter directly.
 */
export interface StorageClient {
  createMap(blob: Buffer, scope?: WorkspaceScope): Promise<MapRecord>;
  getMap(id: string): Promise<MapRecord | null>;
  updateMap(id: string, blob: Buffer): Promise<MapRecord>;
  createShareToken(mapId: string, scope?: WorkspaceScope): Promise<ShareToken>;
  resolveToken(token: string): Promise<ShareToken | null>;
  /**
   * Retrieve the raw blob bytes for a map by id. Returns `null` if the id
   * is malformed, the map row is missing, or the underlying blob storage
   * is missing the object (orphaned row). Phase 4 T8/T9 share-via-link
   * consumes this through the `GET /share/:token/blob` route.
   */
  getBlob(id: string): Promise<Buffer | null>;

  /**
   * Verify the adapter's dependencies are actually reachable right now —
   * DB connection for both adapters, plus the blob store for postgres-minio.
   * Resolves on success, rejects on failure. Consumed by the `/health` route
   * (ISSUES.md Issue 8) so readiness reflects real dependency state instead
   * of an unconditional 200.
   */
  ping(): Promise<void>;

  // ─── Phase 6 A13b/A13c: workspaces table ────────────────────────────
  //
  // Managed-mode features (quotas + Stripe billing) but live on the
  // adapter contract so both adapters expose an identical surface.
  // Self-host servers never call these — `/api/workspaces` and
  // `/api/billing/*` routes 404 when `MANAGED_MODE=false`.
  createWorkspace(input: {
    id: string;
    name: string;
    plan: WorkspacePlan;
  }): Promise<Workspace>;
  getWorkspace(id: string): Promise<Workspace | null>;
  listWorkspaces(): Promise<Workspace[]>;
  updateWorkspacePlan(
    id: string,
    plan: WorkspacePlan,
    stripeCustomerId?: string | null,
  ): Promise<void>;
  /** Count maps belonging to a workspace. Phase 6 A13b quota guard. */
  countWorkspaceMaps(id: string): Promise<number>;
  findWorkspaceByStripeCustomerId(
    customerId: string,
  ): Promise<Workspace | null>;
  /** Gracefully close underlying connections (DB pools, blob clients). */
  close(): Promise<void>;
}
