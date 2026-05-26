// SPDX-License-Identifier: AGPL-3.0-only
// Phase 5 collab-integration Wave B Step 4 — collab.ts snapshot-pull tests.
//
// Exercises the joiner-pull election protocol (Q-P5-1):
//   - setSceneAccessor / setSceneReceiver register callbacks
//   - on connect, the client emits REQUEST_SNAPSHOT
//   - retries every 2 s up to 3 total attempts
//   - retries stop when the 5 s joining window closes
//   - sender-side: emits SCENE_SNAPSHOT to the joiner's id on REQUEST_SNAPSHOT
//   - joiner-side: invokes the receiver on a valid SCENE_SNAPSHOT
//   - SCENE_SNAPSHOT outside the joining window is dropped
//   - disconnect() clears the retry timer (no further emits)
//
// Mocks `socket.io-client` and `getAppConfig`. The WebSocket constructor is
// stubbed on the global to avoid real network use; the YjsLayer / Y.Doc path
// is mocked to a minimal no-op so connect() does not require yjs internals.

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";

import type { ExcalidrawElement } from "@excalidraw/excalidraw";

// ---------------------------------------------------------------------------
// Import after mocks are in place.
// ---------------------------------------------------------------------------

import { encryptScene } from "../collab/scene-crypto";

import { CollabState } from "./collab";

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing the module under test.
// ---------------------------------------------------------------------------

vi.mock("../config/app-config", () => ({
  getAppConfig: () => ({
    realtime: { enabled: true, wsUrl: "" },
  }),
}));

// Mock scene-crypto. jsdom's SubtleCrypto rejects the ArrayBuffer cast used
// inside the real `decryptScene`; that path is exercised by Excalidraw's own
// E2E suite under Playwright. For these unit tests we substitute a JSON
// passthrough so the joiner-side receiver wiring is independently testable.
// A magic sentinel string makes "decrypt failure" deterministic.
const FAKE_DECRYPT_FAILS_SENTINEL = "__decrypt_fails__";

vi.mock("../collab/scene-crypto", () => ({
  encryptScene: vi.fn(
    async (
      elements: ExcalidrawElement[],
      _key: CryptoKey,
    ): Promise<{ iv: string; ciphertext: string }> => ({
      iv: "iv-stub",
      ciphertext: JSON.stringify(elements),
    }),
  ),
  decryptScene: vi.fn(
    async (
      payload: { iv: string; ciphertext: string },
      _key: CryptoKey,
    ): Promise<ExcalidrawElement[]> => {
      if (payload.ciphertext === FAKE_DECRYPT_FAILS_SENTINEL) {
        throw new DOMException("auth tag mismatch", "OperationError");
      }
      return JSON.parse(payload.ciphertext) as ExcalidrawElement[];
    },
  ),
}));

// Minimal CollabUndoManager + YjsLayer stubs — connect() instantiates these
// but the snapshot-pull logic does not exercise them.
vi.mock("@atlasdraw/data", () => ({
  YjsLayer: class {
    doc = { destroy: () => undefined };
  },
  CollabUndoManager: class {
    // eslint-disable-next-line @typescript-eslint/no-useless-constructor
    constructor(_doc: unknown, _origin: string) {}
  },
}));

// Mock socket.io-client to return a controllable fake socket.
type Listener = (event: unknown) => void;

interface FakeSocket {
  id: string;
  connected: boolean;
  on: Mock;
  off: Mock;
  emit: Mock;
  close: Mock;
  // Test helpers (non-prod, attached to the mock instance):
  _trigger: (eventName: string, payload?: unknown) => void;
  _listeners: Map<string, Listener[]>;
}

function makeFakeSocket(id = "joiner-socket-id"): FakeSocket {
  const listeners = new Map<string, Listener[]>();
  const socket: FakeSocket = {
    id,
    connected: true,
    on: vi.fn((event: string, cb: Listener) => {
      const arr = listeners.get(event) ?? [];
      arr.push(cb);
      listeners.set(event, arr);
      return socket;
    }),
    off: vi.fn(),
    emit: vi.fn(),
    close: vi.fn(() => {
      socket.connected = false;
    }),
    _trigger: (eventName: string, payload?: unknown) => {
      const arr = listeners.get(eventName) ?? [];
      // Snapshot the listener list so a handler that registers a new listener
      // mid-fire (or clears one) doesn't perturb this invocation.
      for (const cb of [...arr]) {
        cb(payload as unknown);
      }
    },
    _listeners: listeners,
  };
  return socket;
}

let currentFakeSocket: FakeSocket;

vi.mock("socket.io-client", () => ({
  io: vi.fn(() => currentFakeSocket),
}));

// Stub the global WebSocket so the `new WebSocket(`${wsUrl}/yjs/${roomId}`)`
// call in connect() does not attempt a real connection.
class FakeWebSocket {
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  readyState = 0;
  // eslint-disable-next-line @typescript-eslint/no-useless-constructor
  constructor(_url: string) {}
  close(): void {
    this.readyState = 3;
  }
}

// Install the WebSocket stub on globalThis for all tests in this file.
const originalWebSocket = (globalThis as { WebSocket?: unknown }).WebSocket;
beforeEach(() => {
  (globalThis as { WebSocket: unknown }).WebSocket =
    FakeWebSocket as unknown as typeof WebSocket;
});
afterEach(() => {
  (globalThis as { WebSocket: unknown }).WebSocket =
    originalWebSocket as unknown as typeof WebSocket;
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ROOM_ID = "room-test-1";

function makeKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]);
}

function makeElement(id: string): ExcalidrawElement {
  // Cast through unknown — the snapshot path treats elements opaquely.
  return { id, type: "rectangle", version: 1 } as unknown as ExcalidrawElement;
}

// Find the listener registered for an event via socket.on(name, cb).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function listenersFor(name: string): Listener[] {
  return currentFakeSocket._listeners.get(name) ?? [];
}

// Find an emit call by event name; returns the payload of the most recent.
function lastEmit(name: string): unknown {
  const calls = currentFakeSocket.emit.mock.calls;
  for (let i = calls.length - 1; i >= 0; i--) {
    if (calls[i][0] === name) {
      return calls[i][1];
    }
  }
  return null;
}
function countEmits(name: string): number {
  return currentFakeSocket.emit.mock.calls.filter((c) => c[0] === name).length;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CollabState — setSceneAccessor / setSceneReceiver", () => {
  beforeEach(() => {
    currentFakeSocket = makeFakeSocket("joiner");
  });

  it("setSceneAccessor stores the callback (safe before connect)", () => {
    const collab = new CollabState();
    const accessor = vi.fn(() => null);
    expect(() => collab.setSceneAccessor(accessor)).not.toThrow();
  });

  it("setSceneReceiver stores the callback (safe before connect)", () => {
    const collab = new CollabState();
    const receiver = vi.fn();
    expect(() => collab.setSceneReceiver(receiver)).not.toThrow();
  });
});

describe("CollabState — joiner-side REQUEST_SNAPSHOT pull", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    currentFakeSocket = makeFakeSocket("joiner");
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("emits REQUEST_SNAPSHOT exactly once immediately on connect", () => {
    const collab = new CollabState();
    collab.connect(ROOM_ID);
    currentFakeSocket._trigger("connect");

    expect(countEmits("REQUEST_SNAPSHOT")).toBe(1);
    expect(lastEmit("REQUEST_SNAPSHOT")).toMatchObject({
      roomId: ROOM_ID,
      senderId: "joiner",
    });
  });

  it("re-emits REQUEST_SNAPSHOT after 2 s timeout when no snapshot arrives", async () => {
    const collab = new CollabState();
    collab.connect(ROOM_ID);
    currentFakeSocket._trigger("connect");
    expect(countEmits("REQUEST_SNAPSHOT")).toBe(1);

    // First retry at 2 s.
    await vi.advanceTimersByTimeAsync(2000);
    expect(countEmits("REQUEST_SNAPSHOT")).toBe(2);
  });

  it("stops after 3 total attempts (initial + 2 retries)", async () => {
    const collab = new CollabState();
    collab.connect(ROOM_ID);
    currentFakeSocket._trigger("connect");

    // Advance well past 3 retry intervals; only 3 emits total expected.
    await vi.advanceTimersByTimeAsync(2000); // attempt 2
    await vi.advanceTimersByTimeAsync(2000); // attempt 3 (max)
    await vi.advanceTimersByTimeAsync(2000); // would be 4 — must not fire
    await vi.advanceTimersByTimeAsync(2000);

    expect(countEmits("REQUEST_SNAPSHOT")).toBe(3);
  });

  it("stops retrying after the 5 s joining window closes", async () => {
    const collab = new CollabState();
    collab.connect(ROOM_ID);
    currentFakeSocket._trigger("connect");
    // t=0 attempt 1
    await vi.advanceTimersByTimeAsync(2000); // t=2 attempt 2
    await vi.advanceTimersByTimeAsync(2000); // t=4 attempt 3 (still inside 5 s)
    expect(countEmits("REQUEST_SNAPSHOT")).toBe(3);
    // Even though max is 3, also verify window-close guard: jump past 5 s,
    // then "reset" the attempt counter via disconnect/connect would change
    // scope. Window close alone is enough to halt; nothing more should fire.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(countEmits("REQUEST_SNAPSHOT")).toBe(3);
  });
});

describe("CollabState — sender-side REQUEST_SNAPSHOT handling", () => {
  beforeEach(() => {
    currentFakeSocket = makeFakeSocket("responder");
  });

  it("emits SCENE_SNAPSHOT with the joiner's id as targetId", async () => {
    const key = await makeKey();
    const collab = new CollabState();
    const scene = [makeElement("a"), makeElement("b")];
    collab.setSceneAccessor(() => scene);

    collab.connect(ROOM_ID, key);
    currentFakeSocket._trigger("connect");

    // Relay routes a REQUEST_SNAPSHOT to us. senderId is the joiner's id.
    currentFakeSocket._trigger("REQUEST_SNAPSHOT", {
      roomId: ROOM_ID,
      senderId: "joiner-id",
      timestamp: Date.now(),
    });

    // Wait microtasks — encryptScene is async.
    await new Promise((r) => setTimeout(r, 0));

    const emit = lastEmit("SCENE_SNAPSHOT") as {
      roomId: string;
      targetId: string;
      data: { iv: string; ciphertext: string };
    } | null;
    expect(emit).not.toBeNull();
    expect(emit!.roomId).toBe(ROOM_ID);
    expect(emit!.targetId).toBe("joiner-id");
    expect(typeof emit!.data.iv).toBe("string");
    expect(typeof emit!.data.ciphertext).toBe("string");
  });

  it("declines silently when sceneAccessor is unset", () => {
    const collab = new CollabState();
    collab.connect(ROOM_ID);
    currentFakeSocket._trigger("connect");
    currentFakeSocket._trigger("REQUEST_SNAPSHOT", {
      roomId: ROOM_ID,
      senderId: "joiner-id",
      timestamp: Date.now(),
    });
    expect(countEmits("SCENE_SNAPSHOT")).toBe(0);
  });

  it("declines silently when room key is null", () => {
    const collab = new CollabState();
    collab.setSceneAccessor(() => [makeElement("a")]);
    collab.connect(ROOM_ID); // no key
    currentFakeSocket._trigger("connect");
    currentFakeSocket._trigger("REQUEST_SNAPSHOT", {
      roomId: ROOM_ID,
      senderId: "joiner-id",
      timestamp: Date.now(),
    });
    expect(countEmits("SCENE_SNAPSHOT")).toBe(0);
  });
});

describe("CollabState — joiner-side SCENE_SNAPSHOT receipt", () => {
  beforeEach(() => {
    currentFakeSocket = makeFakeSocket("joiner");
  });

  it("invokes receiver with decrypted elements when valid + in-window + targetId matches", async () => {
    const key = await makeKey();
    const elements = [makeElement("x"), makeElement("y")];
    const encrypted = await encryptScene(elements, key);

    const collab = new CollabState();
    const receiver = vi.fn();
    collab.setSceneReceiver(receiver);

    collab.connect(ROOM_ID, key);
    currentFakeSocket._trigger("connect");

    // Relay forwards a SCENE_SNAPSHOT addressed to us (targetId = our id).
    currentFakeSocket._trigger("SCENE_SNAPSHOT", {
      roomId: ROOM_ID,
      senderId: "responder",
      timestamp: Date.now(),
      targetId: "joiner",
      data: encrypted,
    });

    // decryptScene is async — wait for the microtask drain.
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 0));
    }

    expect(receiver).toHaveBeenCalledTimes(1);
    const received = receiver.mock.calls[0][0] as ExcalidrawElement[];
    expect(received.map((e) => e.id)).toEqual(["x", "y"]);
  });

  it("drops snapshots when targetId does not match our socket.id", async () => {
    const key = await makeKey();
    const elements = [makeElement("x")];
    const encrypted = await encryptScene(elements, key);

    const collab = new CollabState();
    const receiver = vi.fn();
    collab.setSceneReceiver(receiver);
    collab.connect(ROOM_ID, key);
    currentFakeSocket._trigger("connect");

    currentFakeSocket._trigger("SCENE_SNAPSHOT", {
      roomId: ROOM_ID,
      senderId: "responder",
      timestamp: Date.now(),
      targetId: "someone-else",
      data: encrypted,
    });
    await new Promise((r) => setTimeout(r, 0));

    expect(receiver).not.toHaveBeenCalled();
  });

  it("drops snapshots outside the 5 s joining window", async () => {
    vi.useFakeTimers();
    try {
      const key = await makeKey();
      const elements = [makeElement("x")];
      const encrypted = await encryptScene(elements, key);

      const collab = new CollabState();
      const receiver = vi.fn();
      collab.setSceneReceiver(receiver);
      collab.connect(ROOM_ID, key);
      currentFakeSocket._trigger("connect");

      // Advance past the 5 s window.
      await vi.advanceTimersByTimeAsync(6000);

      currentFakeSocket._trigger("SCENE_SNAPSHOT", {
        roomId: ROOM_ID,
        senderId: "responder",
        timestamp: Date.now(),
        targetId: "joiner",
        data: encrypted,
      });
      await vi.advanceTimersByTimeAsync(10);

      expect(receiver).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("silently swallows decrypt failures (wrong key / tampered) per ADR-0010", async () => {
    const key = await makeKey();
    const collab = new CollabState();
    const receiver = vi.fn();
    collab.setSceneReceiver(receiver);
    collab.connect(ROOM_ID, key);
    currentFakeSocket._trigger("connect");

    expect(() => {
      currentFakeSocket._trigger("SCENE_SNAPSHOT", {
        roomId: ROOM_ID,
        senderId: "responder",
        timestamp: Date.now(),
        targetId: "joiner",
        // Sentinel triggers a throw inside the mocked decryptScene.
        data: { iv: "iv-stub", ciphertext: FAKE_DECRYPT_FAILS_SENTINEL },
      });
    }).not.toThrow();

    await new Promise((r) => setTimeout(r, 0));
    expect(receiver).not.toHaveBeenCalled();
  });

  it("stops the retry timer once a snapshot is applied", async () => {
    vi.useFakeTimers();
    try {
      const key = await makeKey();
      const elements = [makeElement("x")];
      const encrypted = await encryptScene(elements, key);

      const collab = new CollabState();
      const receiver = vi.fn();
      collab.setSceneReceiver(receiver);
      collab.connect(ROOM_ID, key);
      currentFakeSocket._trigger("connect");
      expect(countEmits("REQUEST_SNAPSHOT")).toBe(1);

      // Deliver the snapshot before the first 2 s retry fires.
      currentFakeSocket._trigger("SCENE_SNAPSHOT", {
        roomId: ROOM_ID,
        senderId: "responder",
        timestamp: Date.now(),
        targetId: "joiner",
        data: encrypted,
      });
      // Drain decrypt microtasks.
      await vi.advanceTimersByTimeAsync(50);

      expect(receiver).toHaveBeenCalledTimes(1);

      // No more REQUEST_SNAPSHOT emits should fire.
      await vi.advanceTimersByTimeAsync(10_000);
      expect(countEmits("REQUEST_SNAPSHOT")).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("CollabState — disconnect cleanup", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    currentFakeSocket = makeFakeSocket("joiner");
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("clears the retry timer so no further REQUEST_SNAPSHOT fires after disconnect", async () => {
    const collab = new CollabState();
    collab.connect(ROOM_ID);
    currentFakeSocket._trigger("connect");
    expect(countEmits("REQUEST_SNAPSHOT")).toBe(1);

    collab.disconnect();

    // Advance past several retry intervals.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(countEmits("REQUEST_SNAPSHOT")).toBe(1);
  });

  it("is idempotent and safe to call before connect()", () => {
    const collab = new CollabState();
    expect(() => collab.disconnect()).not.toThrow();
    expect(() => collab.disconnect()).not.toThrow();
  });
});
