// postgres-minio adapter tests with pg and S3 mocked. They cover what a real
// database cannot easily show: a schema setup that fails and must be retried,
// S3 error mapping, the health ping, and the pool's idle-client error. The
// SQL itself runs against real Postgres in adapter-contract.test.ts.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createPostgresMinioAdapter } from "./postgres-minio";

const s3SendMock = vi.fn();

// vi.mock factories are hoisted above every import and const in this file,
// so anything they use must come from vi.hoisted(). MiniEmitter stands in for
// pg.Pool being an EventEmitter without importing node:events.
const { queryMock, connectMock, constructedPools, MockPool } = vi.hoisted(
  () => {
    class MiniEmitter {
      private listeners = new Map<
        string,
        Array<(...args: unknown[]) => void>
      >();
      on(event: string, fn: (...args: unknown[]) => void): void {
        const list = this.listeners.get(event) ?? [];
        list.push(fn);
        this.listeners.set(event, list);
      }
      emit(event: string, ...args: unknown[]): void {
        const list = this.listeners.get(event) ?? [];
        if (event === "error" && list.length === 0) {
          // Like a real EventEmitter: an unhandled 'error' event throws.
          throw args[0];
        }
        for (const fn of list) {
          fn(...args);
        }
      }
    }
    const queryMock = vi.fn();
    const connectMock = vi.fn();
    const constructedPools: MiniEmitter[] = [];
    class MockPool extends MiniEmitter {
      query = queryMock;
      connect = connectMock;
      constructor(_opts?: unknown) {
        super();
        constructedPools.push(this);
      }
    }
    return { queryMock, connectMock, constructedPools, MockPool };
  },
);

vi.mock("pg", () => ({ Pool: MockPool }));

vi.mock("@aws-sdk/client-s3", () => {
  class Command {
    public input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }
  class S3Client {
    send = s3SendMock;
  }
  return {
    S3Client,
    PutObjectCommand: class PutObjectCommand extends Command {},
    GetObjectCommand: class GetObjectCommand extends Command {},
    CreateBucketCommand: class CreateBucketCommand extends Command {},
    ListBucketsCommand: class ListBucketsCommand extends Command {},
    DeleteObjectCommand: class DeleteObjectCommand extends Command {},
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

/** A pooled client on which every migration statement succeeds. */
function healthyConnection() {
  return {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    release: vi.fn(),
  };
}

const ID = "a".repeat(21);

describe("postgres-minio adapter", () => {
  beforeEach(() => {
    queryMock.mockReset();
    connectMock.mockReset();
    s3SendMock.mockReset();
    queryMock.mockResolvedValue({ rows: [], rowCount: 0 });
    connectMock.mockImplementation(async () => healthyConnection());
    s3SendMock.mockResolvedValue({});
  });

  it("retries a schema setup that failed, instead of failing every later call", async () => {
    connectMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const client = makeAdapter();

    await expect(client.getMap(ID)).rejects.toThrow("ECONNREFUSED");
    await expect(client.getMap(ID)).resolves.toBeNull();
  });

  it("runs the schema setup once when it succeeds", async () => {
    const client = makeAdapter();

    await client.getMap(ID);
    await client.getMap(ID);

    expect(connectMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a malformed id without a query or an S3 call", async () => {
    const client = makeAdapter();

    expect(await client.getMap("not-a-nanoid")).toBeNull();
    expect(await client.resolveToken("bad")).toBeNull();
    expect(await client.getBlob("../../etc/passwd")).toBeNull();
    expect(queryMock).not.toHaveBeenCalled();
    expect(s3SendMock).not.toHaveBeenCalled();
  });

  describe("getBlob", () => {
    beforeEach(() => {
      queryMock.mockResolvedValue({
        rows: [
          {
            id: ID,
            created_at: new Date(),
            updated_at: new Date(),
            blob_ref: `maps/${ID}.atlasdraw`,
            byte_size: 1,
            write_key_hash: null,
          },
        ],
        rowCount: 1,
      });
    });

    it("returns null when S3 has no such key", async () => {
      const client = makeAdapter();
      s3SendMock.mockResolvedValueOnce({}); // CreateBucket
      s3SendMock.mockRejectedValueOnce(
        Object.assign(new Error("missing"), { name: "NoSuchKey" }),
      );

      expect(await client.getBlob(ID)).toBeNull();
    });

    it("passes any other S3 error to the caller", async () => {
      const client = makeAdapter();
      s3SendMock.mockResolvedValueOnce({}); // CreateBucket
      s3SendMock.mockRejectedValueOnce(
        Object.assign(new Error("denied"), { name: "AccessDenied" }),
      );

      await expect(client.getBlob(ID)).rejects.toThrow("denied");
    });
  });

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

  // When Postgres terminates an idle pooled connection, the Pool emits
  // 'error'. Unhandled, that event throws and ends the whole process, not
  // only the request.
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
