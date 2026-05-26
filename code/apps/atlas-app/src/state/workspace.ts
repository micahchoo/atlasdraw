// SPDX-License-Identifier: AGPL-3.0-only
// atlas-app — Phase 6 A9 workspace context (foundation only).
//
// Surfaces an opaque branded WorkspaceId and a WorkspaceContext object the
// app boots with. Wave 1 wires the value into the HTTP client so the
// X-Workspace-ID header is attached to every storage request when the
// context resolves to a non-null workspace.
//
// The `WorkspaceSwitcher` UI lives in Wave 3 A13a — out of scope here.
// DB-backed validation lives in Wave 3 A13b — the value is opaque at this
// layer (server middleware does the same).

/**
 * Opaque branded workspace identifier. The brand is a compile-time gate;
 * at runtime this is the same string as the X-Workspace-ID header value.
 */
export type WorkspaceId = string & { readonly __brand: "WorkspaceId" };

/**
 * Workspace context surfaced to the app. `id: null` means "self-host /
 * default tenant" — no header is attached and the storage server treats
 * the request as Phase-4-compatible.
 */
export interface WorkspaceContext {
  id: WorkspaceId | null;
}

/**
 * Mint a WorkspaceId from a raw string. Narrow cast keeps accidental
 * widening grep-able. Returns `null` for empty input so callers can pipe
 * env / config straight in.
 */
export function asWorkspaceId(
  value: string | null | undefined,
): WorkspaceId | null {
  if (!value) {
    return null;
  }
  return value as WorkspaceId;
}

/**
 * Resolve the current workspace at boot from an env-shaped record. Mode:
 *   - Vite exposes `import.meta.env.VITE_WORKSPACE_ID` (string | undefined).
 *   - Tests inject the value directly via `resolveWorkspaceFromEnv({...})`.
 *
 * Wave 3 A13a will replace this with a UI-driven selection persisted to
 * localStorage; for Wave 1 the boot path is sufficient.
 */
export function resolveWorkspaceFromEnv(
  env: Record<string, string | undefined> = {},
): WorkspaceContext {
  const raw = env.VITE_WORKSPACE_ID ?? env.WORKSPACE_ID ?? null;
  return { id: asWorkspaceId(raw) };
}

/**
 * Reduce a context to the header pair the HTTP client should send. Returns
 * an empty object when the context is null — never emits an empty-string
 * header value (the server middleware treats those as "absent" too).
 */
export function workspaceHeaders(
  ctx: WorkspaceContext,
): Record<string, string> {
  if (ctx.id === null) {
    return {};
  }
  return { "X-Workspace-ID": ctx.id };
}
