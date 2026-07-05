// postgres-minio adapter tests — pg + S3 client mocked at the module level
// (per scrub note: testcontainers would be heavier than necessary here).
// We assert SQL strings, parameter shape, and S3 key derivation.

import { beforeEach, describe, expect, it, vi } from "vitest";

// Imported AFTER mocks so the adapter sees the mocked modules.
import {
  __postgresMinioInternals,
  createPostgresMinioAdapter,
} from "./postgres-minio";

const s3SendMock = vi.fn();

// vi.mock factories are hoisted above every import/const in this file, so
// anything they reference must go through vi.hoisted() — a plain top-level
// const (other than the literal vi.fn() pattern Vitest special-cases) throws
// a TDZ ReferenceError. MiniEmitter mirrors real pg.Pool being an
// EventEmitter (on/emit), without importing node:events (same hoisting
// problem). constructedPools tracks instances so the idle-client 'error'
// test below can emit on the one the adapter actually wired a handler onto,
// without changing the adapter's public API.
const { queryMock, constructedPools, MockPool } = vi.hoisted(() => {
  class MiniEmitter {
    private listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    on(event: string, fn: (...args: unknown[]) => void): void {
      const list = this.listeners.get(event) ?? [];
      list.push(fn);
      this.listeners.set(event, list);
    }
    emit(event: string, ...args: unknown[]): void {
      const list = this.listeners.get(event) ?? [];
      if (event === "error" && list.length === 0) {
        // Mirrors real EventEmitter/pg.Pool: an unhandled 'error' event throws.
        throw args[0];
      }
      for (const fn of list) {
        fn(...args);
      }
    }
  }
  const queryMock = vi.fn();
  const constructedPools: MiniEmitter[] = [];
  class MockPool extends MiniEmitter {
    query = queryMock;
    constructor(_opts?: unknown) {
      super();
      constructedPools.push(this);
    }
  }
  return { queryMock, constructedPools, MockPool };
});

vi.mock("pg", () => ({ Pool: MockPool }));

vi.mock("@aws-sdk/client-s3", () => {
  class S3Client {
    send = s3SendMock;
    // eslint-disable-next-line @typescript-eslint/no-useless-constructor
    constructor(_opts?: unknown) {}
  }
  class PutObjectCommand {
    public input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }
  class GetObjectCommand {
    public input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }
  class CreateBucketCommand {
    public input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }
  class ListBucketsCommand {
    public input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }
  return {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
    CreateBucketCommand,
    ListBucketsCommand,
  };
});

function makeAdapter() {
  return createPostgresMinioAdapter({
    databaseUrl: "postgres://x",
    blobEndpoint: "http://minio:9000",
    blobAccessKey: "k",
    blobSecretKey: "s",
  });
}

describe("postgres-minio adapter", () => {
  beforeEach(() => {
    queryMock.mockReset();
    s3SendMock.mockReset();
    // Default: schema-create + INSERT/UPDATE return empty result sets.
    queryMock.mockResolvedValue({ rows: [], rowCount: 0 });
    s3SendMock.mockResolvedValue({});
  });

  it("constant bucket name", () => {
    expect(__postgresMinioInternals.BUCKET).toBe("atlasdraw-maps");
  });

  it("createMap puts blob under maps/<id>.atlasdraw and inserts a row", async () => {
    const client = makeAdapter();
    const record = await client.createMap(Buffer.from("hello"));

    expect(record.id).toMatch(/^[A-Za-z0-9_-]{21}$/);
    expect(record.blob_ref).toBe(`maps/${record.id}.atlasdraw`);
    expect(record.byte_size).toBe(5);

    // S3 was called with a CreateBucketCommand then a PutObjectCommand.
    const putCalls = s3SendMock.mock.calls.map(([c]) => c);
    const putObject = putCalls.find(
      (c) => (c as { input: { Key?: string } }).input.Key !== undefined,
    ) as { input: { Bucket: string; Key: string; Body: Buffer } } | undefined;
    expect(putObject).toBeDefined();
    expect(putObject!.input.Bucket).toBe("atlasdraw-maps");
    expect(putObject!.input.Key).toBe(record.blob_ref);

    // Postgres INSERT after schema creation.
    const queries = queryMock.mock.calls.map(([sql]) => sql as string);
    expect(
      queries.some((q) => /CREATE TABLE IF NOT EXISTS maps/i.test(q)),
    ).toBe(true);
    const insertCall = queryMock.mock.calls.find(([sql]) =>
      /INSERT INTO maps/i.test(sql as string),
    );
    expect(insertCall).toBeDefined();
    const params = insertCall![1] as unknown[];
    expect(params[0]).toBe(record.id);
    expect(params[3]).toBe(record.blob_ref);
    expect(params[4]).toBe(5);
  });

  it("getMap with malformed id short-circuits to null (no SQL)", async () => {
    const client = makeAdapter();
    const result = await client.getMap("not-a-nanoid");
    expect(result).toBeNull();
    const selectCalls = queryMock.mock.calls.filter(([sql]) =>
      /SELECT .* FROM maps WHERE id =/i.test(sql as string),
    );
    expect(selectCalls.length).toBe(0);
  });

  it("getMap returns null when SELECT yields no rows", async () => {
    const client = makeAdapter();
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // schema
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // select
    const result = await client.getMap("a".repeat(21));
    expect(result).toBeNull();
  });

  it("getMap maps a row through with ISO-stringified timestamps", async () => {
    const client = makeAdapter();
    const id = "a".repeat(21);
    const created = new Date("2026-01-01T00:00:00.000Z");
    const updated = new Date("2026-01-02T00:00:00.000Z");
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // schema
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          id,
          created_at: created,
          updated_at: updated,
          blob_ref: `maps/${id}.atlasdraw`,
          byte_size: 42,
        },
      ],
      rowCount: 1,
    });
    const result = await client.getMap(id);
    expect(result).toEqual({
      id,
      created_at: created.toISOString(),
      updated_at: updated.toISOString(),
      blob_ref: `maps/${id}.atlasdraw`,
      byte_size: 42,
      // Phase 6 A9: rows queried without a workspace_id column return null
      // here. The mock row in this test doesn't set workspace_id, so the
      // rowToMap normaliser produces null.
      workspace_id: null,
    });
  });

  it("updateMap throws not-found when the row is missing", async () => {
    const client = makeAdapter();
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // schema
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // select
    await expect(
      client.updateMap("a".repeat(21), Buffer.from("x")),
    ).rejects.toThrow(/not found/);
  });

  it("createShareToken inserts with mode=read and 7d expiry", async () => {
    const client = makeAdapter();
    const mapId = "a".repeat(21);
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // schema
    queryMock.mockResolvedValueOnce({ rows: [{ id: mapId }], rowCount: 1 }); // map lookup
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // insert

    const token = await client.createShareToken(mapId);
    expect(token.mode).toBe("read");
    expect(token.map_id).toBe(mapId);

    const insertCall = queryMock.mock.calls.find(([sql]) =>
      /INSERT INTO share_tokens/i.test(sql as string),
    );
    expect(insertCall).toBeDefined();
    const params = insertCall![1] as unknown[];
    expect(params[0]).toBe(token.token);
    expect(params[1]).toBe(mapId);
    expect(params[2]).toBe("read");

    const expires = params[3] as Date;
    const created = params[4] as Date;
    expect(expires.getTime() - created.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("resolveToken returns null for malformed token without SQL", async () => {
    const client = makeAdapter();
    const result = await client.resolveToken("bad");
    expect(result).toBeNull();
    const selectCalls = queryMock.mock.calls.filter(([sql]) =>
      /FROM share_tokens/i.test(sql as string),
    );
    expect(selectCalls.length).toBe(0);
  });

  // Phase 4 T8 amendment — getBlob support for /share/:token/blob.
  it("getBlob returns null for malformed id (no S3 call)", async () => {
    const client = makeAdapter();
    const result = await client.getBlob("not-a-nanoid");
    expect(result).toBeNull();
    // No GetObjectCommand should have been issued.
    const getCalls = s3SendMock.mock.calls.filter(
      ([c]) => (c as { input: { Key?: string } }).input?.Key !== undefined,
    );
    expect(getCalls.length).toBe(0);
  });

  it("getBlob issues a GetObjectCommand under maps/<id>.atlasdraw", async () => {
    const client = makeAdapter();
    const id = "a".repeat(21);
    const bytes = new Uint8Array([1, 2, 3, 4]);
    // CreateBucketCommand (ensureBucket) then GetObjectCommand.
    s3SendMock.mockResolvedValueOnce({}); // CreateBucket (or already-exists swallowed)
    s3SendMock.mockResolvedValueOnce({
      Body: {
        transformToByteArray: async () => bytes,
      },
    });

    const result = await client.getBlob(id);
    expect(result).not.toBeNull();
    expect(Buffer.from(bytes).equals(result!)).toBe(true);

    const getCmd = s3SendMock.mock.calls
      .map(([c]) => c as { input: { Bucket?: string; Key?: string } })
      .find((c) => c.input.Key !== undefined);
    expect(getCmd).toBeDefined();
    expect(getCmd!.input.Bucket).toBe("atlasdraw-maps");
    expect(getCmd!.input.Key).toBe(`maps/${id}.atlasdraw`);
  });

  it("getBlob returns null on NoSuchKey from S3", async () => {
    const client = makeAdapter();
    const id = "a".repeat(21);
    // First call: CreateBucket (swallowed). Second call: GetObject throws.
    s3SendMock.mockResolvedValueOnce({});
    const err = Object.assign(new Error("missing"), { name: "NoSuchKey" });
    s3SendMock.mockRejectedValueOnce(err);

    const result = await client.getBlob(id);
    expect(result).toBeNull();
  });

  // ISSUES.md Issue 8 — /health now pings both dependencies for real.
  describe("ping", () => {
    it("resolves when both postgres and S3 are reachable", async () => {
      const client = makeAdapter();
      await expect(client.ping()).resolves.toBeUndefined();
      expect(queryMock).toHaveBeenCalledWith("SELECT 1");
    });

    it("checks S3 via ListBuckets, not HeadBucket on our own (possibly-unmade) bucket", async () => {
      const client = makeAdapter();
      await client.ping();
      const listBucketsCall = s3SendMock.mock.calls
        .map(([c]) => c)
        .find((c) => c?.constructor?.name === "ListBucketsCommand");
      expect(listBucketsCall).toBeDefined();
    });

    it("rejects when postgres is down", async () => {
      const client = makeAdapter();
      queryMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
      await expect(client.ping()).rejects.toThrow("ECONNREFUSED");
    });

    it("rejects when MinIO/S3 is down", async () => {
      const client = makeAdapter();
      s3SendMock.mockRejectedValueOnce(new Error("connect ECONNREFUSED"));
      await expect(client.ping()).rejects.toThrow("ECONNREFUSED");
    });
  });

  // ISSUES.md Issue 8 (forced check): stopping the postgres container mid-
  // session crashed the ENTIRE storage process, not just the in-flight
  // request — an idle Pool client whose connection the server terminated
  // emits an 'error' event, and node's default EventEmitter behavior for an
  // unhandled 'error' event is to throw. Found by actually stopping a real
  // postgres container against a running server, not by reasoning about it.
  it("does not crash when the pool emits an idle-client error (postgres restart/termination)", () => {
    makeAdapter();
    const pool = constructedPools[constructedPools.length - 1]!;
    expect(() => {
      pool.emit(
        "error",
        Object.assign(
          new Error("terminating connection due to administrator command"),
          { code: "57P01" },
        ),
      );
    }).not.toThrow();
  });
});
