<!-- ADR-0019-MARKER: bring-your-own-s3 -->

# ADR-0019: Bring Your Own S3 — the Full Stack Runs No Object Store

- **Status:** Accepted. Done on 2026-10-01 (commit `aead19d`).
- **Date:** 2026-10-01
- **Amends:** ADR-0007 (storage dual mode): the `postgres-minio` adapter
  keeps its name and now takes any S3-compatible bucket.
- **Relates to:** `SECURITY.md` row 25

## Context

The full stack (`infra/docker-compose.yml`) ran MinIO for map bytes, with a
one-shot `minio-init` job that made the bucket and a user limited to it. The
compose file pinned MinIO's last community image by digest.

MinIO stopped publishing community images. On 2026-10-01 neither
`docker.io/minio/minio` nor `quay.io/minio/minio` served an anonymous pull.
A new operator, on a host that did not already hold the image, could not
start the full stack. A pinned digest that nobody serves is not a
dependency; it is a broken promise in the guide.

Three choices were possible:

1. **Swap in another bundled server** (Garage, SeaweedFS). This keeps "one
   command starts everything", but it repeats the bet: the project would
   again own the operation, upgrades and backups of an object store, and
   depend on one vendor's image policy.
2. **Build MinIO from source in this repository.** This adds a Go build and
   a security-update duty to the project, for a component that is not
   Atlasdraw.
3. **Bring your own S3.** The stack runs no object store. The operator
   points the storage server at a bucket they already trust.

## Decision

Bring your own S3 (choice 3).

- `infra/docker-compose.yml` has no `minio` or `minio-init` service and no
  `miniodata` volume.
- The storage server reads `BLOB_ENDPOINT`, `BLOB_ACCESS_KEY` and
  `BLOB_SECRET_KEY` (compose refuses to start without them), `BLOB_BUCKET`
  (default `atlasdraw-maps`), `BLOB_REGION` (default `us-east-1`) and
  `BLOB_FORCE_PATH_STYLE` (default `"true"`; `"false"` for virtual-hosted
  URLs such as AWS S3).
- The adapter sends `HeadBucket`. If the bucket is missing, it sends
  `CreateBucket`, which succeeds only if the key may create buckets. A
  `BucketAlreadyExists` (another account owns the name) is an error.
- The storage mode keeps its name, `postgres-minio`. The name is historical:
  it means Postgres and any S3. Renaming it would break every existing
  `.env` for no change in behaviour.
- `docs/self-host/production.md` "Blob storage" says how to choose a
  provider and gives the least-privilege policy for a key limited to one
  bucket.

## Consequences

- **More setup for a new operator.** The full stack needs a bucket and a
  key before its first start. The minimal stack (`sqlite-fs`) is unchanged
  and still needs nothing.
- **The bucket key's scope is the operator's.** `minio-init` used to make a
  user limited to the bucket. Now the operator makes that key, and the
  server cannot check its scope. The guide gives the policy; `SECURITY.md`
  row 25 records the residual.
- **Backups of map bytes are the operator's.** The guide points to bucket
  versioning, replication, or a scheduled `rclone sync` / `aws s3 sync`.
- **Operators who ran the bundled MinIO must move their data.** The
  `miniodata` volume is no longer mounted, but compose does not delete it.
  The CHANGELOG "Upgrade" step says how to keep that MinIO or copy the
  bucket before the volume goes.
- **The storage server makes outbound calls** to `BLOB_ENDPOINT` when it is
  outside the host. The egress note in the guide names it.
- **CI tests against a real S3 server: SeaweedFS** (decided 2026-10-01).
  The storage job starts `chrislusf/seaweedfs` with its S3 gateway and sets
  `ATLASDRAW_TEST_S3_URL`, so the adapter contract tests run against real
  S3 together with real Postgres. SeaweedFS is Apache-2.0, one container,
  and its images pull without an account.
