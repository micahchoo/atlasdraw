// The StorageClient contract, run against each adapter on the schema that the
// migration runner builds. The adapters run the runner when they start, so
// these tests also prove that their queries match the migrated schema.
//
// The Postgres half runs only when ATLASDRAW_TEST_PG_URL names a database.
// Each test works in a private schema that it drops afterwards. The blob
// store is real S3 when ATLASDRAW_TEST_S3_URL names one
// (`http://<access key>:<secret>@host:port`, e.g. a MinIO container), each
// test in its own bucket; otherwise an in-memory bucket stands in for it.

import * as fs from "node:fs";
import * as path from "node:path";
import { PassThrough, Readable } from "node:stream";

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { Pool } from "pg";
import * as tmp from "tmp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { bodyOf, textOf } from "../test-support";

import { createPostgresMinioAdapter } from "./postgres-minio";
import { createSqliteFsAdapter } from "./sqlite-fs";

import type { StorageClient } from "../types";

const S3_URL = process.env.ATLASDRAW_TEST_S3_URL;

const { bucket } = vi.hoisted(() => ({
  bucket: new Map<string, { bytes: Buffer; modified: Date }>(),
}));

vi.mock("@aws-sdk/client-s3", async (importOriginal) => {
  if (process.env.ATLASDRAW_TEST_S3_URL) {
    return importOriginal();
  }
  class Command {
    constructor(
      public input: { Key?: string; Body?: unknown; Prefix?: string },
    ) {}
  }
  class HeadBucketCommand extends Command {}
  class CreateBucketCommand extends Command {}
  class ListObjectsV2Command extends Command {}
  class PutObjectCommand extends Command {}
  class GetObjectCommand extends Command {}
  class DeleteObjectCommand extends Command {}
  class S3Client {
    async send(
      cmd: Command,
      opts?: { abortSignal?: AbortSignal },
    ): Promise<unknown> {
      if (cmd instanceof PutObjectCommand) {
        // Like the SDK: an abort ends the upload with a rejection.
        const aborted = new Promise<never>((_, reject) =>
          opts?.abortSignal?.addEventListener("abort", () =>
            reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          ),
        );
        const chunks: Buffer[] = [];
        const read = (async () => {
          for await (const c of cmd.input.Body as AsyncIterable<Uint8Array>) {
            chunks.push(Buffer.from(c));
          }
        })();
        await Promise.race([read, aborted]);
        bucket.set(cmd.input.Key!, {
          bytes: Buffer.concat(chunks),
          modified: new Date(),
        });
        return {};
      }
      if (cmd instanceof DeleteObjectCommand) {
        bucket.delete(cmd.input.Key!);
        return {};
      }
      if (cmd instanceof GetObjectCommand) {
        const entry = bucket.get(cmd.input.Key!);
        if (!entry) {
          throw Object.assign(new Error("missing"), { name: "NoSuchKey" });
        }
        return {
          Body: Readable.from([entry.bytes]),
          ContentLength: entry.bytes.byteLength,
        };
      }
      if (cmd instanceof ListObjectsV2Command) {
        return {
          Contents: [...bucket.entries()]
            .filter(([key]) => key.startsWith(cmd.input.Prefix ?? ""))
            .map(([Key, e]) => ({ Key, LastModified: e.modified })),
          IsTruncated: false,
        };
      }
      return {};
    }
  }
  return {
    S3Client,
    HeadBucketCommand,
    CreateBucketCommand,
    ListObjectsV2Command,
    PutObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand,
  };
});

/** Opens a client on one store. Every call reaches the same data. */
interface Store {
  open(): StorageClient;
  /** Puts a blob in the store that no row points to, as a crash would. */
  plantOrphan(name: string): Promise<void>;
  dispose(): Promise<void>;
}

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
/** Sweep options that delete every keyless map and every orphan at once. */
const NO_GRACE = { legacyGraceMs: 0, orphanGraceMs: 0 };

/** A body whose bytes the test releases: part now, the rest on `finish`. */
function heldBody(size: number) {
  const stream = new PassThrough();
  stream.write(Buffer.alloc(size / 2, 1));
  return {
    body: { stream, size },
    finish: () => stream.end(Buffer.alloc(size - size / 2, 2)),
    fail: () => stream.destroy(new Error("connection reset")),
  };
}

const tick = () => new Promise((r) => setTimeout(r, 20));

const UNKNOWN_ID = "a".repeat(21);
const HASH = "f".repeat(64);
const DAY_MS = 24 * 60 * 60 * 1000;

function describeContract(name: string, makeStore: () => Promise<Store>) {
  describe(`${name} adapter contract`, () => {
    let store: Store;
    let clients: StorageClient[];

    function open(): StorageClient {
      const client = store.open();
      clients.push(client);
      return client;
    }

    beforeEach(async () => {
      store = await makeStore();
      clients = [];
    });

    afterEach(async () => {
      for (const client of clients) {
        await client.close();
      }
      await store.dispose();
    });

    it("createMap stores the bytes and the key hash; getMap returns the record", async () => {
      const client = open();
      const record = await client.createMap(bodyOf("hello"), HASH);

      expect(record.byte_size).toBe(5);
      expect(record.write_key_hash).toBe(HASH);
      expect(await client.getMap(record.id)).toEqual(record);
      expect(await textOf(client.getBlob(record.id))).toBe("hello");
    });

    it("getMap and getBlob return null for an unknown id", async () => {
      const client = open();

      expect(await client.getMap(UNKNOWN_ID)).toBeNull();
      expect(await client.getBlob(UNKNOWN_ID)).toBeNull();
    });

    it("updateMap replaces the bytes and keeps created_at and the key hash", async () => {
      const client = open();
      const created = await client.createMap(bodyOf("v1"), HASH);
      await new Promise((r) => setTimeout(r, 5));

      const updated = await client.updateMap(created.id, bodyOf("v-two"));

      expect(updated.created_at).toBe(created.created_at);
      expect(updated.updated_at).not.toBe(created.updated_at);
      expect(updated.write_key_hash).toBe(HASH);
      expect(await client.getMap(created.id)).toEqual(updated);
      expect(await textOf(client.getBlob(created.id))).toBe("v-two");
    });

    it("a map starts at revision 1, and each write counts one more", async () => {
      const client = open();
      const created = await client.createMap(bodyOf("v1"), HASH);

      const second = await client.updateMap(created.id, bodyOf("v2"));
      const third = await client.updateMap(created.id, bodyOf("v3"));

      expect(created.revision).toBe(1);
      expect(second.revision).toBe(2);
      expect(third.revision).toBe(3);
      expect((await client.getMap(created.id))?.revision).toBe(3);
      expect((await client.getBlob(created.id))?.revision).toBe(3);
    });

    it("a write that names another revision is refused, and stores nothing", async () => {
      const client = open();
      const map = await client.createMap(bodyOf("v1"), HASH);
      await client.updateMap(map.id, bodyOf("v2"));

      const stale = client.updateMap(map.id, bodyOf("stale"), {
        ifRevision: 1,
      });

      await expect(stale).rejects.toThrow(/^revision conflict/);
      await expect(stale).rejects.toMatchObject({ revision: 2 });
      expect(await textOf(client.getBlob(map.id))).toBe("v2");
      expect(await client.totalBytes()).toBe(2);
      expect((await client.sweep(new Date(), NO_GRACE)).orphans).toBe(0);
    });

    it("of two writes from one revision, the second to finish is refused", async () => {
      const client = open();
      const map = await client.createMap(bodyOf("v1"), HASH);
      const slow = heldBody(64 * 1024);

      const late = client.updateMap(map.id, slow.body, { ifRevision: 1 });
      await tick();
      await client.updateMap(map.id, bodyOf("first"), { ifRevision: 1 });
      slow.finish();

      await expect(late).rejects.toThrow(/^revision conflict/);
      expect(await textOf(client.getBlob(map.id))).toBe("first");
      expect(await client.totalBytes()).toBe(5);
      expect((await client.sweep(new Date(), NO_GRACE)).orphans).toBe(0);
    });

    it("with no version policy, a write keeps no earlier bytes", async () => {
      const client = open();
      const map = await client.createMap(bodyOf("v1"), HASH);
      await client.updateMap(map.id, bodyOf("v-2"));

      expect(await client.listVersions(map.id)).toEqual([]);
      expect(await client.getVersionBlob(map.id, 1)).toBeNull();
      expect(await client.totalBytes()).toBe(3);
      expect(await client.listVersions(UNKNOWN_ID)).toBeNull();
    });

    it("keeps the replaced revisions, newest first, up to `keep`", async () => {
      const client = open();
      const policy = { versions: { keep: 2, intervalMs: 0 } };
      const map = await client.createMap(bodyOf("v1"), HASH);
      for (const bytes of ["v2", "v3", "v4!"]) {
        await client.updateMap(map.id, bodyOf(bytes), policy);
      }

      const versions = await client.listVersions(map.id);

      expect(versions?.map((v) => v.revision)).toEqual([3, 2]);
      expect(versions?.map((v) => v.byte_size)).toEqual([2, 2]);
      expect(await textOf(client.getVersionBlob(map.id, 3))).toBe("v3");
      expect(await textOf(client.getVersionBlob(map.id, 4))).toBe("v4!");
      expect((await client.getVersionBlob(map.id, 2))?.revision).toBe(2);
      expect(await client.getVersionBlob(map.id, 1)).toBeNull();
      expect(await client.totalBytes()).toBe(7);
      expect((await client.sweep(new Date(), NO_GRACE)).orphans).toBe(0);
      expect(await textOf(client.getVersionBlob(map.id, 2))).toBe("v2");
    });

    it("keeps a save that stood for the interval, or came an interval after the last one kept", async () => {
      const client = open();
      const versions = { keep: 10, intervalMs: 10 * MINUTE_MS };
      const map = await client.createMap(bodyOf("v1"), HASH);
      const t0 = Date.parse(map.updated_at);
      const write = (bytes: string, minutes: number) =>
        client.updateMap(map.id, bodyOf(bytes), {
          versions,
          at: new Date(t0 + minutes * MINUTE_MS),
        });

      await write("v2", 1); // v1 is the first: kept
      await write("v3", 2); // v2 stood 1 min, 1 min after v1: replaced
      await write("v4", 30); // v3 stood 28 min: kept
      await write("v5", 31); // v4 came 28 min after v3: kept

      const kept = await client.listVersions(map.id);
      expect(kept?.map((v) => v.revision)).toEqual([4, 3, 1]);
      expect(kept?.[0]?.saved_at).toBe(
        new Date(t0 + 30 * MINUTE_MS).toISOString(),
      );
      expect(await client.totalBytes()).toBe(8);
      expect((await client.sweep(new Date(), NO_GRACE)).orphans).toBe(0);
    });

    it("a checkpoint keeps the replaced bytes whatever the interval", async () => {
      const client = open();
      const versions = { keep: 10, intervalMs: 60 * MINUTE_MS };
      const map = await client.createMap(bodyOf("v1"), HASH);
      await client.updateMap(map.id, bodyOf("v2"), { versions });
      await client.updateMap(map.id, bodyOf("v3"), { versions });

      await client.updateMap(map.id, bodyOf("v4"), {
        versions,
        checkpoint: true,
      });

      expect(
        (await client.listVersions(map.id))?.map((v) => v.revision),
      ).toEqual([3, 1]);
    });

    it("counts kept versions against the cap", async () => {
      const client = open();
      const opts = { maxTotalBytes: 10, versions: { keep: 5, intervalMs: 0 } };
      const map = await client.createMap(bodyOf("12345"), HASH, opts);
      await client.updateMap(map.id, bodyOf("1234"), opts);

      await expect(
        client.updateMap(map.id, bodyOf("12"), opts),
      ).rejects.toThrow(/storage full/);

      expect(await client.totalBytes()).toBe(9);
      expect(await textOf(client.getBlob(map.id))).toBe("1234");
      expect(
        (await client.listVersions(map.id))?.map((v) => v.revision),
      ).toEqual([1]);
    });

    it("deleteMap removes the versions and their bytes", async () => {
      const client = open();
      const versions = { keep: 5, intervalMs: 0 };
      const map = await client.createMap(bodyOf("v1"), HASH);
      await client.updateMap(map.id, bodyOf("v2"), { versions });

      expect(await client.deleteMap(map.id)).toBe(true);

      expect(await client.getVersionBlob(map.id, 1)).toBeNull();
      expect(await client.totalBytes()).toBe(0);
      expect((await client.sweep(new Date(), NO_GRACE)).orphans).toBe(0);
    });

    it("updateMap rejects an unknown id as not found", async () => {
      const client = open();

      await expect(client.updateMap(UNKNOWN_ID, bodyOf("x"))).rejects.toThrow(
        /^not found:/,
      );
    });

    it("getBlob gives the bytes as a stream with their size", async () => {
      const client = open();
      const map = await client.createMap(bodyOf("streamed"), HASH);

      const read = await client.getBlob(map.id);

      expect(read?.size).toBe(8);
      expect(await textOf(read)).toBe("streamed");
    });

    it("createMap refuses a body that ends before its size, and stores nothing", async () => {
      const client = open();
      const short = { stream: Readable.from([Buffer.from("abc")]), size: 5 };

      await expect(client.createMap(short, HASH)).rejects.toThrow();

      expect(await client.totalBytes()).toBe(0);
    });

    it("updateMap refuses a body longer than its size, and keeps the old bytes", async () => {
      const client = open();
      const map = await client.createMap(bodyOf("old"), HASH);
      const long = {
        stream: Readable.from([Buffer.from("too long")]),
        size: 3,
      };

      await expect(client.updateMap(map.id, long)).rejects.toThrow();

      expect(await textOf(client.getBlob(map.id))).toBe("old");
      expect((await client.getMap(map.id))?.byte_size).toBe(3);
    });

    it("createShareToken stores a token with no expiry by default", async () => {
      const client = open();
      const map = await client.createMap(bodyOf("blob"), HASH);

      const token = await client.createShareToken(map.id, null);

      expect(token.map_id).toBe(map.id);
      expect(token.mode).toBe("read");
      expect(token.expires_at).toBeNull();
      expect(await client.resolveToken(token.token)).toEqual(token);
    });

    it("createShareToken stores the expiry it is given", async () => {
      const client = open();
      const map = await client.createMap(bodyOf("blob"), HASH);
      const expires = new Date(Date.now() + 7 * DAY_MS);

      const token = await client.createShareToken(map.id, expires);

      expect(token.expires_at).toBe(expires.toISOString());
      expect(await client.resolveToken(token.token)).toEqual(token);
    });

    it("createShareToken rejects an unknown map as not found", async () => {
      const client = open();

      await expect(client.createShareToken(UNKNOWN_ID, null)).rejects.toThrow(
        /^not found:/,
      );
    });

    it("deleteShareToken removes only a token of the named map", async () => {
      const client = open();
      const mine = await client.createMap(bodyOf("a"), HASH);
      const theirs = await client.createMap(bodyOf("b"), HASH);
      const token = await client.createShareToken(theirs.id, null);

      expect(await client.deleteShareToken(mine.id, token.token)).toBe(false);
      expect(await client.resolveToken(token.token)).not.toBeNull();
      expect(await client.deleteShareToken(theirs.id, token.token)).toBe(true);
      expect(await client.resolveToken(token.token)).toBeNull();
    });

    it("deleteMap removes the map, its tokens and its bytes, and nothing else", async () => {
      const client = open();
      const gone = await client.createMap(bodyOf("gone"), HASH);
      const kept = await client.createMap(bodyOf("kept"), HASH);
      const goneToken = await client.createShareToken(gone.id, null);
      const keptToken = await client.createShareToken(kept.id, null);

      expect(await client.deleteMap(gone.id)).toBe(true);

      expect(await client.getMap(gone.id)).toBeNull();
      expect(await client.getBlob(gone.id)).toBeNull();
      expect(await client.resolveToken(goneToken.token)).toBeNull();
      expect(await client.getMap(kept.id)).not.toBeNull();
      expect(await client.resolveToken(keptToken.token)).not.toBeNull();
      expect(await client.totalBytes()).toBe(4);
      expect(await client.deleteMap(gone.id)).toBe(false);
      expect(await client.deleteMap(UNKNOWN_ID)).toBe(false);
    });

    it("totalBytes sums the stored maps", async () => {
      const client = open();
      expect(await client.totalBytes()).toBe(0);
      const map = await client.createMap(bodyOf("12345"), HASH);
      await client.createMap(bodyOf("123"), null);
      await client.updateMap(map.id, bodyOf("1"));

      expect(await client.totalBytes()).toBe(4);
    });

    it("sweep deletes expired tokens and the keyless maps no live token reads", async () => {
      const client = open();
      const now = new Date();
      const past = new Date(now.getTime() - DAY_MS);
      const future = new Date(now.getTime() + DAY_MS);
      // Kept: the owner can come back with the key.
      const owned = await client.createMap(bodyOf("owned"), HASH);
      const ownedExpired = await client.createShareToken(owned.id, past);
      // Kept: a live link still reads it.
      const linked = await client.createMap(bodyOf("linked"), null);
      const live = await client.createShareToken(linked.id, future);
      const forever = await client.createMap(bodyOf("forever"), null);
      await client.createShareToken(forever.id, null);
      // Gone: no key and every link has expired.
      const orphan = await client.createMap(bodyOf("orphan"), null);
      const dead = await client.createShareToken(orphan.id, past);
      // Gone: no key and no link at all.
      const bare = await client.createMap(bodyOf("bare"), null);

      const swept = await client.sweep(now, NO_GRACE);

      expect(swept).toEqual({ tokens: 2, maps: 2, orphans: 0 });
      expect(await client.resolveToken(ownedExpired.token)).toBeNull();
      expect(await client.resolveToken(dead.token)).toBeNull();
      expect(await client.resolveToken(live.token)).not.toBeNull();
      for (const kept of [owned, linked, forever]) {
        expect(await client.getMap(kept.id)).not.toBeNull();
      }
      for (const gone of [orphan, bare]) {
        expect(await client.getMap(gone.id)).toBeNull();
        expect(await client.getBlob(gone.id)).toBeNull();
      }
      expect(await client.sweep(now, NO_GRACE)).toEqual({
        tokens: 0,
        maps: 0,
        orphans: 0,
      });
    });

    it("keeps a keyless map until the grace after the upgrade has passed", async () => {
      const client = open();
      const legacy = await client.createMap(bodyOf("pre-key map"), null);
      const grace = { legacyGraceMs: 90 * DAY_MS, orphanGraceMs: HOUR_MS };

      const early = await client.sweep(new Date(), grace);
      const late = await client.sweep(
        new Date(Date.now() + 91 * DAY_MS),
        grace,
      );

      expect(early.maps).toBe(0);
      expect(late.maps).toBe(1);
      expect(await client.getMap(legacy.id)).toBeNull();
    });

    it("sweep removes a blob no row points to, once it is older than the grace", async () => {
      const client = open();
      const kept = await client.createMap(bodyOf("kept"), HASH);
      await store.plantOrphan("zzzzzzzzzzzzzzzzzzzzz.orphan.atlasdraw");
      const grace = { legacyGraceMs: 0, orphanGraceMs: HOUR_MS };

      const fresh = await client.sweep(new Date(), grace);
      const old = await client.sweep(new Date(Date.now() + 2 * HOUR_MS), grace);

      expect(fresh.orphans).toBe(0);
      expect(old.orphans).toBe(1);
      expect(await textOf(client.getBlob(kept.id))).toBe("kept");
      expect((await client.sweep(new Date(), NO_GRACE)).orphans).toBe(0);
    });

    it("updateMap writes under a new blob and leaves no old one behind", async () => {
      const client = open();
      const map = await client.createMap(bodyOf("v1"), HASH);

      const updated = await client.updateMap(map.id, bodyOf("v2"));

      expect(updated.blob_ref).not.toBe(map.blob_ref);
      expect((await client.sweep(new Date(), NO_GRACE)).orphans).toBe(0);
      expect(await textOf(client.getBlob(map.id))).toBe("v2");
    });

    it("a write cut partway leaves the old map whole and counts nothing", async () => {
      const client = open();
      const map = await client.createMap(bodyOf("old"), HASH);
      const held = heldBody(64 * 1024);

      const write = client.updateMap(map.id, held.body);
      await tick();
      held.fail();

      await expect(write).rejects.toThrow();
      expect(await textOf(client.getBlob(map.id))).toBe("old");
      expect(await client.totalBytes()).toBe(3);
      expect((await client.sweep(new Date(), NO_GRACE)).orphans).toBe(0);
    });

    it("a write that loses the race with a delete answers not found and leaves no blob", async () => {
      const client = open();
      const map = await client.createMap(bodyOf("old"), HASH);
      const held = heldBody(64 * 1024);

      const write = client.updateMap(map.id, held.body);
      await tick();
      expect(await client.deleteMap(map.id)).toBe(true);
      held.finish();

      await expect(write).rejects.toThrow(/^not found:/);
      expect(await client.getMap(map.id)).toBeNull();
      expect(await client.totalBytes()).toBe(0);
      expect((await client.sweep(new Date(), NO_GRACE)).orphans).toBe(0);
    });

    it("concurrent creates cannot pass the cap", async () => {
      const client = open();
      const cap = { maxTotalBytes: 1000 };

      const results = await Promise.allSettled(
        Array.from({ length: 20 }, () =>
          client.createMap(bodyOf(Buffer.alloc(100)), HASH, cap),
        ),
      );

      const made = results.filter((r) => r.status === "fulfilled").length;
      expect(made).toBe(10);
      expect(await client.totalBytes()).toBe(1000);
      for (const r of results) {
        if (r.status === "rejected") {
          expect(String(r.reason)).toMatch(/storage full/);
        }
      }
    });

    it("counts a rewrite by its growth, and refuses growth past the cap", async () => {
      const client = open();
      const cap = { maxTotalBytes: 10 };
      const map = await client.createMap(bodyOf("12345678"), HASH, cap);

      await client.updateMap(map.id, bodyOf("87654321"), cap);
      await expect(
        client.updateMap(map.id, bodyOf("12345678901"), cap),
      ).rejects.toThrow(/storage full/);

      expect(await textOf(client.getBlob(map.id))).toBe("87654321");
      expect(await client.totalBytes()).toBe(8);
    });

    it("a failed write gives its reserved bytes back", async () => {
      const client = open();
      const cap = { maxTotalBytes: 10 };
      const short = { stream: Readable.from([Buffer.from("abc")]), size: 10 };

      await expect(client.createMap(short, HASH, cap)).rejects.toThrow();
      await client.createMap(bodyOf("1234567890"), HASH, cap);

      expect(await client.totalBytes()).toBe(10);
    });

    it("a restarted server reads what the first one wrote", async () => {
      const first = open();
      const map = await first.createMap(bodyOf("kept"), HASH);
      const token = await first.createShareToken(map.id, null);

      const second = open();

      expect(await second.getMap(map.id)).toEqual(map);
      expect(await second.resolveToken(token.token)).toEqual(token);
    });

    it("ping resolves", async () => {
      await expect(open().ping()).resolves.toBeUndefined();
    });
  });
}

describeContract("sqlite-fs", async () => {
  const dir = tmp.dirSync({ unsafeCleanup: true });
  return {
    open: () => createSqliteFsAdapter({ dataDir: dir.name }),
    plantOrphan: async (name) =>
      fs.writeFileSync(path.join(dir.name, "blobs", name), "orphan"),
    dispose: async () => dir.removeCallback(),
  };
});

const PG_URL = process.env.ATLASDRAW_TEST_PG_URL;

describe.skipIf(!PG_URL)("against real Postgres", () => {
  describeContract("postgres-minio", async () => {
    const admin = new Pool({ connectionString: PG_URL });
    const schema = `contract_test_${Date.now()}_${Math.floor(
      Math.random() * 1e6,
    )}`;
    await admin.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(PG_URL!);
    url.searchParams.set("options", `-c search_path=${schema}`);
    bucket.clear();
    const s3 = S3_URL ? new URL(S3_URL) : null;
    const blobBucket = `contract-${Date.now()}-${Math.floor(
      Math.random() * 1e6,
    )}`;
    return {
      open: () =>
        createPostgresMinioAdapter({
          databaseUrl: url.toString(),
          blobEndpoint: s3 ? s3.origin : "http://s3.invalid",
          blobAccessKey: s3 ? decodeURIComponent(s3.username) : "k",
          blobSecretKey: s3 ? decodeURIComponent(s3.password) : "s",
          blobBucket,
          blobRegion: "us-east-1",
        }),
      plantOrphan: async (name) => {
        if (!s3) {
          bucket.set(`maps/${name}`, {
            bytes: Buffer.from("orphan"),
            modified: new Date(),
          });
          return;
        }
        await new S3Client({
          endpoint: s3.origin,
          region: "us-east-1",
          forcePathStyle: true,
          credentials: {
            accessKeyId: decodeURIComponent(s3.username),
            secretAccessKey: decodeURIComponent(s3.password),
          },
        }).send(
          new PutObjectCommand({
            Bucket: blobBucket,
            Key: `maps/${name}`,
            Body: "orphan",
          }),
        );
      },
      dispose: async () => {
        await admin.query(`DROP SCHEMA ${schema} CASCADE`);
        await admin.end();
      },
    };
  });
});
