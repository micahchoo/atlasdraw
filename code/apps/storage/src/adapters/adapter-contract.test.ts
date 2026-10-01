// The StorageClient contract, run against each adapter on the schema that the
// migration runner builds. The adapters run the runner when they start, so
// these tests also prove that their queries match the migrated schema.
//
// The Postgres half runs only when ATLASDRAW_TEST_PG_URL names a database.
// Each test works in a private schema that it drops afterwards. S3 is an
// in-memory bucket here: this suite checks the SQL, not the blob store.

import { Pool } from "pg";
import * as tmp from "tmp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createPostgresMinioAdapter } from "./postgres-minio";
import { createSqliteFsAdapter } from "./sqlite-fs";

import type { StorageClient } from "../types";

const { bucket } = vi.hoisted(() => ({ bucket: new Map<string, Buffer>() }));

vi.mock("@aws-sdk/client-s3", () => {
  class Command {
    constructor(public input: { Key?: string; Body?: Buffer }) {}
  }
  class CreateBucketCommand extends Command {}
  class ListBucketsCommand extends Command {}
  class PutObjectCommand extends Command {}
  class GetObjectCommand extends Command {}
  class DeleteObjectCommand extends Command {}
  class S3Client {
    async send(cmd: Command): Promise<unknown> {
      if (cmd instanceof PutObjectCommand) {
        bucket.set(cmd.input.Key!, Buffer.from(cmd.input.Body!));
        return {};
      }
      if (cmd instanceof DeleteObjectCommand) {
        bucket.delete(cmd.input.Key!);
        return {};
      }
      if (cmd instanceof GetObjectCommand) {
        const bytes = bucket.get(cmd.input.Key!);
        if (!bytes) {
          throw Object.assign(new Error("missing"), { name: "NoSuchKey" });
        }
        return { Body: { transformToByteArray: async () => bytes } };
      }
      return {};
    }
  }
  return {
    S3Client,
    CreateBucketCommand,
    ListBucketsCommand,
    PutObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand,
  };
});

/** Opens a client on one store. Every call reaches the same data. */
interface Store {
  open(): StorageClient;
  dispose(): Promise<void>;
}

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
      const record = await client.createMap(Buffer.from("hello"), HASH);

      expect(record.byte_size).toBe(5);
      expect(record.write_key_hash).toBe(HASH);
      expect(await client.getMap(record.id)).toEqual(record);
      expect((await client.getBlob(record.id))?.toString()).toBe("hello");
    });

    it("getMap and getBlob return null for an unknown id", async () => {
      const client = open();

      expect(await client.getMap(UNKNOWN_ID)).toBeNull();
      expect(await client.getBlob(UNKNOWN_ID)).toBeNull();
    });

    it("updateMap replaces the bytes and keeps created_at and the key hash", async () => {
      const client = open();
      const created = await client.createMap(Buffer.from("v1"), HASH);
      await new Promise((r) => setTimeout(r, 5));

      const updated = await client.updateMap(created.id, Buffer.from("v-two"));

      expect(updated.created_at).toBe(created.created_at);
      expect(updated.updated_at).not.toBe(created.updated_at);
      expect(updated.write_key_hash).toBe(HASH);
      expect(await client.getMap(created.id)).toEqual(updated);
      expect((await client.getBlob(created.id))?.toString()).toBe("v-two");
    });

    it("updateMap rejects an unknown id as not found", async () => {
      const client = open();

      await expect(
        client.updateMap(UNKNOWN_ID, Buffer.from("x")),
      ).rejects.toThrow(/^not found:/);
    });

    it("createShareToken stores a token with no expiry by default", async () => {
      const client = open();
      const map = await client.createMap(Buffer.from("blob"), HASH);

      const token = await client.createShareToken(map.id, null);

      expect(token.map_id).toBe(map.id);
      expect(token.mode).toBe("read");
      expect(token.expires_at).toBeNull();
      expect(await client.resolveToken(token.token)).toEqual(token);
    });

    it("createShareToken stores the expiry it is given", async () => {
      const client = open();
      const map = await client.createMap(Buffer.from("blob"), HASH);
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
      const mine = await client.createMap(Buffer.from("a"), HASH);
      const theirs = await client.createMap(Buffer.from("b"), HASH);
      const token = await client.createShareToken(theirs.id, null);

      expect(await client.deleteShareToken(mine.id, token.token)).toBe(false);
      expect(await client.resolveToken(token.token)).not.toBeNull();
      expect(await client.deleteShareToken(theirs.id, token.token)).toBe(true);
      expect(await client.resolveToken(token.token)).toBeNull();
    });

    it("totalBytes sums the stored maps", async () => {
      const client = open();
      expect(await client.totalBytes()).toBe(0);
      const map = await client.createMap(Buffer.from("12345"), HASH);
      await client.createMap(Buffer.from("123"), null);
      await client.updateMap(map.id, Buffer.from("1"));

      expect(await client.totalBytes()).toBe(4);
    });

    it("sweep deletes expired tokens and the keyless maps no live token reads", async () => {
      const client = open();
      const now = new Date();
      const past = new Date(now.getTime() - DAY_MS);
      const future = new Date(now.getTime() + DAY_MS);
      // Kept: the owner can come back with the key.
      const owned = await client.createMap(Buffer.from("owned"), HASH);
      const ownedExpired = await client.createShareToken(owned.id, past);
      // Kept: a live link still reads it.
      const linked = await client.createMap(Buffer.from("linked"), null);
      const live = await client.createShareToken(linked.id, future);
      const forever = await client.createMap(Buffer.from("forever"), null);
      await client.createShareToken(forever.id, null);
      // Gone: no key and every link has expired.
      const orphan = await client.createMap(Buffer.from("orphan"), null);
      const dead = await client.createShareToken(orphan.id, past);
      // Gone: no key and no link at all.
      const bare = await client.createMap(Buffer.from("bare"), null);

      const swept = await client.sweep(now);

      expect(swept).toEqual({ tokens: 2, maps: 2 });
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
      expect(await client.sweep(now)).toEqual({ tokens: 0, maps: 0 });
    });

    it("a restarted server reads what the first one wrote", async () => {
      const first = open();
      const map = await first.createMap(Buffer.from("kept"), HASH);
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
    return {
      open: () =>
        createPostgresMinioAdapter({
          databaseUrl: url.toString(),
          blobEndpoint: "http://s3.invalid",
          blobAccessKey: "k",
          blobSecretKey: "s",
        }),
      dispose: async () => {
        await admin.query(`DROP SCHEMA ${schema} CASCADE`);
        await admin.end();
      },
    };
  });
});
