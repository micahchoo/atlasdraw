// SPDX-License-Identifier: MIT
//
// Every size cap in one table. The relay, the editor and the file reader
// read their numbers from here, so two checks of one thing cannot disagree.
// limits.test.ts holds the order that must stay true: a record fits in a
// message, a message in a room, an import in an upload, and an upload's
// layer in an archive entry.

const KiB = 1 << 10;
const MiB = 1 << 20;

/** The largest single room record. A message holds one, its key and framing. */
const RECORD_BYTES = 15 * MiB;

export const LIMITS = {
  /** The largest WebSocket message the relay reads. */
  message: 16 * MiB,
  /** The largest room state the relay holds. */
  room: 64 * MiB,
  /** The largest single value one key of a room doc holds. */
  record: {
    /** One raster layer's image. */
    raster: RECORD_BYTES,
    /** One data layer's FeatureCollection, as the room doc encodes it. */
    features: RECORD_BYTES,
    /** One image file of the drawing, as bytes (Excalidraw's file cap). */
    image: 4 * MiB,
  },
  /** The largest map the storage server takes in one request. */
  upload: 50 * MiB,
  /** The largest data file the editor imports as a layer. */
  import: 50 * MiB,
  /**
   * The largest GeoTIFF the editor imports. Its image is resampled to at
   * most 2048 px, so the layer it makes stays under `record.raster`.
   */
  importRaster: 256 * MiB,
  /** What one `.atlasdraw` archive may expand to when it is read. */
  archive: {
    /** Entries in the zip. */
    entries: 10_000,
    /** Bytes of one entry, inflated. */
    entryBytes: 256 * MiB,
    /** Bytes of all entries together, inflated. */
    totalBytes: 512 * MiB,
  },
  /** What a client keeps free in each room message for framing. */
  frame: 64 * KiB,
} as const;

/** The archive caps, as the file reader takes them. */
export type ArchiveLimits = {
  readonly [K in keyof typeof LIMITS.archive]: number;
};
