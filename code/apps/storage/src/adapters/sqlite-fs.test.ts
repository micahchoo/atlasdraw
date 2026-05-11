import * as fs from "node:fs";
import * as path from "node:path";
import * as tmp from "tmp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
    const record = await client.createMap(blob);

    expect(record.id).toMatch(/^[A-Za-z0-9_-]{21}$/);
    expect(record.byte_size).toBe(blob.byteLength);
    expect(record.blob_ref).toBe(`blobs/${record.id}.atlasdraw`);
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
    const created = await client.createMap(Buffer.from("v1"));
    // Sleep a tick so the ISO string differs.
    await new Promise((r) => setTimeout(r, 10));

    const v2 = Buffer.from("version two — longer");
    const updated = await client.updateMap(created.id, v2);

    expect(updated.id).toBe(created.id);
    expect(updated.byte_size).toBe(v2.byteLength);
    expect(updated.created_at).toBe(created.created_at);
    expect(updated.updated_at).not.toBe(created.updated_at);

    const onDisk = fs.readFileSync(path.join(scratch.name, updated.blob_ref));
    expect(onDisk.equals(v2)).toBe(true);
  });

  it("updateMap throws not-found for unknown id", async () => {
    const client = createSqliteFsAdapter({ dataDir: scratch.name });
    await expect(
      client.updateMap("a".repeat(21), Buffer.from("x")),
    ).rejects.toThrow(/not found/);
  });

  it("createShareToken links to map, sets mode=read and 7d expiry", async () => {
    const client = createSqliteFsAdapter({ dataDir: scratch.name });
    const map = await client.createMap(Buffer.from("blob"));
    const token = await client.createShareToken(map.id);

    expect(token.token).toMatch(/^[A-Za-z0-9_-]{21}$/);
    expect(token.map_id).toBe(map.id);
    expect(token.mode).toBe("read");

    const expiresAt = new Date(token.expires_at).getTime();
    const createdAt = new Date(token.created_at).getTime();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    expect(expiresAt - createdAt).toBe(sevenDaysMs);
  });

  it("createShareToken throws for unknown map", async () => {
    const client = createSqliteFsAdapter({ dataDir: scratch.name });
    await expect(client.createShareToken("a".repeat(21))).rejects.toThrow(
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
    const map = await client.createMap(Buffer.from("blob"));
    const created = await client.createShareToken(map.id);
    const resolved = await client.resolveToken(created.token);
    expect(resolved).toEqual(created);
  });
});
