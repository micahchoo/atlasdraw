import * as fs from "node:fs";
import * as path from "node:path";

import * as tmp from "tmp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { bodyOf, bytesOf } from "../test-support";

import { createSqliteFsAdapter } from "./sqlite-fs";

describe("sqlite-fs adapter", () => {
  let scratch: tmp.DirResult;

  beforeEach(() => {
    scratch = tmp.dirSync({ unsafeCleanup: true });
  });

  afterEach(() => {
    scratch.removeCallback();
  });

  it("createMap writes blob + row, then getMap roundtrips", async () => {
    const client = createSqliteFsAdapter({ dataDir: scratch.name });
    const blob = Buffer.from("hello, atlas");
    const record = await client.createMap(bodyOf(blob), null);

    expect(record.id).toMatch(/^[A-Za-z0-9_-]{21}$/);
    expect(record.byte_size).toBe(blob.byteLength);
    expect(record.blob_ref).toMatch(
      new RegExp(`^blobs/${record.id}\\.[0-9a-f]{12}\\.atlasdraw$`),
    );
    expect(record.created_at).toBe(record.updated_at);

    // Blob actually written to disk.
    const onDisk = fs.readFileSync(path.join(scratch.name, record.blob_ref));
    expect(onDisk.equals(blob)).toBe(true);

    const fetched = await client.getMap(record.id);
    expect(fetched).toEqual(record);
  });

  it("getMap returns null for unknown id (well-formed)", async () => {
    const client = createSqliteFsAdapter({ dataDir: scratch.name });
    const result = await client.getMap("a".repeat(21));
    expect(result).toBeNull();
  });

  it("getMap returns null for malformed id (defense in depth)", async () => {
    const client = createSqliteFsAdapter({ dataDir: scratch.name });
    expect(await client.getMap("not-a-nanoid")).toBeNull();
    expect(await client.getMap("")).toBeNull();
    expect(await client.getMap("a".repeat(22))).toBeNull();
  });

  it("updateMap changes byte_size, updated_at, and the blob bytes", async () => {
    const client = createSqliteFsAdapter({ dataDir: scratch.name });
    const created = await client.createMap(bodyOf("v1"), null);
    // Sleep a tick so the ISO string differs.
    await new Promise((r) => setTimeout(r, 10));

    const v2 = Buffer.from("version two — longer");
    const updated = await client.updateMap(created.id, bodyOf(v2));

    expect(updated.id).toBe(created.id);
    expect(updated.byte_size).toBe(v2.byteLength);
    expect(updated.created_at).toBe(created.created_at);
    expect(updated.updated_at).not.toBe(created.updated_at);

    const onDisk = fs.readFileSync(path.join(scratch.name, updated.blob_ref));
    expect(onDisk.equals(v2)).toBe(true);
  });

  it("updateMap throws not-found for unknown id", async () => {
    const client = createSqliteFsAdapter({ dataDir: scratch.name });
    await expect(client.updateMap("a".repeat(21), bodyOf("x"))).rejects.toThrow(
      /not found/,
    );
  });

  it("createShareToken links to map and sets mode=read", async () => {
    const client = createSqliteFsAdapter({ dataDir: scratch.name });
    const map = await client.createMap(bodyOf("blob"), null);
    const token = await client.createShareToken(map.id, null);

    expect(token.token).toMatch(/^[A-Za-z0-9_-]{21}$/);
    expect(token.map_id).toBe(map.id);
    expect(token.mode).toBe("read");
  });

  it("writes a blob through a temp file and leaves none behind", async () => {
    const client = createSqliteFsAdapter({ dataDir: scratch.name });
    const map = await client.createMap(bodyOf("v1"), null);
    await client.updateMap(map.id, bodyOf("v2"));

    const updated = await client.getMap(map.id);
    expect(fs.readdirSync(path.join(scratch.name, "blobs"))).toEqual([
      path.basename(updated!.blob_ref),
    ]);
  });

  it("createShareToken throws for unknown map", async () => {
    const client = createSqliteFsAdapter({ dataDir: scratch.name });
    await expect(client.createShareToken("a".repeat(21), null)).rejects.toThrow(
      /not found/,
    );
  });

  it("resolveToken returns null for unknown token", async () => {
    const client = createSqliteFsAdapter({ dataDir: scratch.name });
    expect(await client.resolveToken("a".repeat(21))).toBeNull();
    expect(await client.resolveToken("malformed")).toBeNull();
  });

  it("resolveToken returns the token row when it exists", async () => {
    const client = createSqliteFsAdapter({ dataDir: scratch.name });
    const map = await client.createMap(bodyOf("blob"), null);
    const created = await client.createShareToken(map.id, null);
    const resolved = await client.resolveToken(created.token);
    expect(resolved).toEqual(created);
  });

  // Blob retrieval for GET /share/:token/blob.
  it("getBlob returns the original bytes for an existing map", async () => {
    const client = createSqliteFsAdapter({ dataDir: scratch.name });
    const payload = Buffer.from("scene-bytes-roundtrip");
    const map = await client.createMap(bodyOf(payload), null);
    const fetched = await bytesOf(client.getBlob(map.id));
    expect(fetched?.equals(payload)).toBe(true);
  });

  it("getBlob returns null for unknown id (well-formed)", async () => {
    const client = createSqliteFsAdapter({ dataDir: scratch.name });
    const fetched = await client.getBlob("a".repeat(21));
    expect(fetched).toBeNull();
  });

  it("getBlob returns null for malformed id (defense in depth)", async () => {
    const client = createSqliteFsAdapter({ dataDir: scratch.name });
    expect(await client.getBlob("not-a-nanoid")).toBeNull();
    expect(await client.getBlob("")).toBeNull();
    expect(await client.getBlob("../../etc/passwd")).toBeNull();
    expect(await client.getBlob("a".repeat(22))).toBeNull();
  });

  // /health pings the adapter's real dependencies.
  it("ping resolves when the db + blobs dir are reachable", async () => {
    const client = createSqliteFsAdapter({ dataDir: scratch.name });
    await expect(client.ping()).resolves.toBeUndefined();
  });

  it("ping rejects once the underlying db is closed", async () => {
    const client = createSqliteFsAdapter({ dataDir: scratch.name });
    await client.close();
    await expect(client.ping()).rejects.toThrow();
  });
});
