// SPDX-License-Identifier: AGPL-3.0-only
//
// Who this browser is to collaborators: a fixed id, a name and a colour,
// kept in localStorage. Comments carry the id and name; room presence
// carries all three. There is no account behind it: anyone can claim any
// name, and the id only lets this browser keep its own comments. The person
// can change the name (setDisplayName); the id and colour stay.

export interface Identity {
  readonly id: string;
  readonly name: string;
  readonly color: string;
}

const KEY = "atlasdraw:identity";

const COLORS = [
  "#e03131",
  "#2f9e44",
  "#1971c2",
  "#f08c00",
  "#9c36b5",
  "#0c8599",
  "#c2255c",
  "#5c940d",
];

function isIdentity(value: unknown): value is Identity {
  const v = value as Identity | null;
  return (
    typeof v === "object" &&
    v !== null &&
    typeof v.id === "string" &&
    typeof v.name === "string" &&
    typeof v.color === "string"
  );
}

/** A new identity: a random id, "Guest" and four letters, a palette colour. */
export function newIdentity(): Identity {
  const id = crypto.randomUUID();
  const tag = id.replace(/-/g, "").slice(0, 4).toUpperCase();
  const color = COLORS[parseInt(id.slice(0, 2), 16) % COLORS.length]!;
  return { id, name: `Guest ${tag}`, color };
}

let cached: Identity | null = null;

/** This browser's identity, made and saved on first use. */
export function localIdentity(): Identity {
  if (cached) {
    return cached;
  }
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (isIdentity(saved)) {
      cached = saved;
      return saved;
    }
  } catch {
    // Unreadable or unavailable storage: make one for this session.
  }
  cached = newIdentity();
  try {
    localStorage.setItem(KEY, JSON.stringify(cached));
  } catch {
    // Private mode: the identity lasts for this session only.
  }
  return cached;
}

/** The longest display name; room presence cuts a peer's name to it too. */
export const MAX_NAME_LENGTH = 64;

/**
 * Change this browser's display name and save it. Runs of white space become
 * one space and the name is cut to MAX_NAME_LENGTH. An empty name changes
 * nothing. Returns the identity after the change.
 */
export function setDisplayName(name: string): Identity {
  const current = localIdentity();
  const clean = name.trim().replace(/\s+/g, " ").slice(0, MAX_NAME_LENGTH);
  if (!clean || clean === current.name) {
    return current;
  }
  cached = { ...current, name: clean };
  try {
    localStorage.setItem(KEY, JSON.stringify(cached));
  } catch {
    // Private mode or full storage: the name lasts for this session only.
  }
  return cached;
}
