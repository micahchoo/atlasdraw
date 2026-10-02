// SPDX-License-Identifier: AGPL-3.0-only
//
// A backup of this browser's maps, with the write keys of their server maps.
//
// The maps and the keys live only in this browser's IndexedDB. A cleared or
// evicted browser loses them, and with the keys the owner loses the only
// way to change, share or stop a published map
// (docs/architecture/adr/0017-maps-carry-a-write-key.md). The backup is one
// JSON file the owner keeps: each map as the `.atlasdraw` bytes a save
// writes, and each server map's id and key. Restoring it in another browser
// gives that browser the maps and the ownership.
//
// The file holds write keys. Anyone with it can change and delete the
// owner's server maps; the dialog says so.
//
// A restore adds; it never replaces. A map or key this browser already holds
// is kept as it is, because it may be newer than the backup.

import {
  base64UrlToUint8Array,
  uint8ArrayToBase64Url,
  write,
} from "@atlasdraw/data";

import { admit } from "./documentGate";
import {
  importServerKey,
  serverKeys,
  type ServerKey,
} from "./remoteMapIdCache";

import type { PersistenceStore } from "./persistence";

const FORMAT = "atlasdraw-backup";
const VERSION = 1;

interface BackupBody {
  format: typeof FORMAT;
  version: typeof VERSION;
  createdAt: string;
  maps: Array<{ id: string; title: string; bytes: string }>;
  servers: ServerKey[];
}

/** What a restore did. */
export interface RestoreResult {
  /** Maps added to this browser. */
  added: number;
  /** Maps this browser already had, kept as they are. */
  kept: number;
  /** Server keys added. */
  keys: number;
  /** Server keys this browser already had, kept as they are. */
  keptKeys: number;
}

/** A Blob's bytes. jsdom's Blob has no arrayBuffer(). */
function bytesOf(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === "function") {
    return blob.arrayBuffer().then((b) => new Uint8Array(b));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsArrayBuffer(blob);
  });
}

/** Every saved map and every server key, as one file to download. */
export async function makeBackup(
  store: PersistenceStore,
  now: Date = new Date(),
): Promise<{ blob: Blob; fileName: string; maps: number; keys: number }> {
  const maps: BackupBody["maps"] = [];
  for (const summary of await store.list()) {
    if (summary.needsNewerBuild) {
      continue;
    }
    const doc = await store.read(summary.id);
    if (doc) {
      maps.push({
        id: doc.manifest.id,
        title: doc.manifest.title,
        bytes: uint8ArrayToBase64Url(await bytesOf(await write(doc))),
      });
    }
  }
  const servers = await serverKeys();
  const body: BackupBody = {
    format: FORMAT,
    version: VERSION,
    createdAt: now.toISOString(),
    maps,
    servers,
  };
  return {
    blob: new Blob([JSON.stringify(body)], { type: "application/json" }),
    fileName: `atlasdraw-backup-${now.toISOString().slice(0, 10)}.json`,
    maps: maps.length,
    keys: servers.length,
  };
}

const NOT_A_BACKUP = "This file is not an Atlasdraw backup.";

function parse(text: string): BackupBody {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(NOT_A_BACKUP);
  }
  const b = body as Partial<BackupBody> | null;
  if (
    !b ||
    b.format !== FORMAT ||
    b.version !== VERSION ||
    !Array.isArray(b.maps) ||
    !Array.isArray(b.servers)
  ) {
    throw new Error(NOT_A_BACKUP);
  }
  return b as BackupBody;
}

/**
 * Add a backup's keys and maps to this browser. Every map goes through the
 * document gate; a map the gate refuses is left out and counted as kept
 * by nobody, so the result says less than the file holds.
 */
export async function restoreBackupFile(
  store: PersistenceStore,
  file: Blob,
): Promise<RestoreResult> {
  const body = parse(new TextDecoder().decode(await bytesOf(file)));
  const result: RestoreResult = { added: 0, kept: 0, keys: 0, keptKeys: 0 };
  // Keys first: a map saved here is pushed to its server map, which needs
  // the key, or the push would make a second server map.
  for (const key of body.servers) {
    if (await importServerKey(key)) {
      result.keys += 1;
    } else {
      result.keptKeys += 1;
    }
  }
  for (const map of body.maps) {
    if (await store.read(map.id)) {
      result.kept += 1;
      continue;
    }
    const admitted = await admit(
      new Blob([base64UrlToUint8Array(map.bytes) as BlobPart]),
      "file",
    );
    if (admitted.ok && admitted.doc.manifest.id === map.id) {
      const saved = await store.save(admitted.doc);
      if (saved.kind === "saved") {
        result.added += 1;
      }
    }
  }
  return result;
}
