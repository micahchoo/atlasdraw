// SPDX-License-Identifier: AGPL-3.0-only
//
// The editor's one history: one order of undo steps over two sources.
//
//   document steps   layer, title and basemap commands, and comment edits,
//                    each recorded as its own undo and redo
//                    (state/documentUndo.ts)
//   drawing steps    Excalidraw's own entries, which stay in Excalidraw.
//                    The fork's `api.history` is the drawing adapter; this
//                    module mirrors its stacks from the changes it reports.
//
// Undo and redo (the keys, the drawing's buttons through `historyHost`, the
// menu and the palette) call whichever source owns the newest step. Every
// step has a serial number; the newest undo step has the highest, and the
// next redo step the lowest.
//
// `dirty` is the history's position against the position at the last save,
// and nothing else. The position is the newest document step and the newest
// drawing step that changed elements, so a selection (an Excalidraw entry
// that changes only the app state) is not an edit. Opening another map is
// `reset`: the new map starts clean, with nothing to undo.
//
// A room keeps undo per user (docs/architecture/adr/0014-collab-trust-model.md):
// remote changes reach neither source. The document records only its own
// commands (`origin: "local"`), and Excalidraw records only local edits.

import type { HistoryHost, HistoryChange } from "@atlasdraw/excalidraw/types";

/** Where the history is. Opaque: compare it, never read it. */
export type HistoryPosition = string & { readonly __brand: "HistoryPosition" };

export interface History {
  undo(): void;
  redo(): void;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** The position is not the position of the last save. */
  readonly dirty: boolean;
  readonly position: HistoryPosition;
  /**
   * The content at `at` is saved; by default, the content now. A save that
   * read the map earlier passes the position it read at, so an edit made
   * while it ran stays dirty.
   */
  markSaved(at?: HistoryPosition): void;
  /** Called after any of the above may have changed. */
  subscribe(listener: () => void): () => void;
}

/** One step that is not the drawing's: it knows how to undo and redo itself. */
export interface HistoryStep {
  undo(): void;
  redo(): void;
}

/** The drawing's history, as the fork's `api.history` gives it. */
export interface DrawingHistory {
  undo(): void;
  redo(): void;
  depth(): { undo: number; redo: number };
  clearRedo(): void;
  clear(): void;
  subscribe(listener: (change: HistoryChange) => void): () => void;
}

/** The History, and what the editor does to it. */
export interface EditorHistory extends History {
  /**
   * A new step, newest. Ignored while a step's own undo or redo runs.
   * `merge`: a step with the same key as the newest step, recorded soon
   * after it and with no save between, joins it, so a drag of a slider or
   * the digits typed into one field are one step.
   */
  record(step: HistoryStep, options?: { merge?: string }): void;
  /** The steps recorded while `run` runs are one step. */
  group(run: () => void): void;
  /** The drawing whose entries share the order; null detaches it. */
  attachDrawing(drawing: DrawingHistory | null): void;
  /**
   * Another map is open: forget every step, empty the drawing's history,
   * and call the present saved.
   */
  reset(): void;
}

type DocumentStep = {
  serial: number;
  step: HistoryStep;
  merge?: string;
  at: number;
};

export interface HistoryOptions {
  /** The clock merges are measured with. */
  now?: () => number;
  /** How soon a step must follow the newest to join it. */
  mergeWindowMs?: number;
}
/** A drawing entry; `content` false for one that changed no element. */
type DrawingMark = { serial: number; content: boolean };

export function createHistory(options: HistoryOptions = {}): EditorHistory {
  const { now = Date.now, mergeWindowMs = 1000 } = options;
  let serial = 0;
  let undoSteps: DocumentStep[] = [];
  let redoSteps: DocumentStep[] = [];
  let undoMarks: DrawingMark[] = [];
  let redoMarks: DrawingMark[] = [];
  let drawing: DrawingHistory | null = null;
  let detachDrawing: () => void = () => {};
  let replaying = false;
  let grouping: HistoryStep[] | null = null;
  const listeners = new Set<() => void>();

  const positionNow = (): HistoryPosition => {
    const step = undoSteps[undoSteps.length - 1]?.serial ?? 0;
    let mark = 0;
    for (let i = undoMarks.length - 1; i >= 0; i--) {
      if (undoMarks[i].content) {
        mark = undoMarks[i].serial;
        break;
      }
    }
    return `${step}:${mark}` as HistoryPosition;
  };
  let saved = positionNow();

  const notify = (): void => {
    for (const listener of Array.from(listeners)) {
      listener();
    }
  };

  /** Move marks between the stacks until they hold what the drawing holds. */
  const followDepth = (): void => {
    if (!drawing) {
      return;
    }
    const { undo } = drawing.depth();
    while (undoMarks.length > undo && undoMarks.length > 0) {
      redoMarks.push(undoMarks.pop()!);
    }
    while (undoMarks.length < undo && redoMarks.length > 0) {
      undoMarks.push(redoMarks.pop()!);
    }
  };

  const onDrawingChange = (change: HistoryChange): void => {
    switch (change.kind) {
      case "record":
        undoMarks.push({ serial: ++serial, content: change.elements });
        if (change.elements) {
          // Excalidraw dropped its redo entries; an edit drops ours too.
          redoMarks = [];
          redoSteps = [];
        }
        break;
      case "undo":
      case "redo":
        followDepth();
        break;
      case "clear": {
        const wasClean = positionNow() === saved;
        undoMarks = [];
        redoMarks = [];
        if (wasClean) {
          saved = positionNow();
        }
        break;
      }
      case "clear-redo":
        redoMarks = [];
        break;
    }
    notify();
  };

  const replay = (run: () => void): void => {
    replaying = true;
    try {
      run();
    } finally {
      replaying = false;
    }
  };

  const record = (
    step: HistoryStep,
    recordOptions: { merge?: string } = {},
  ) => {
    if (replaying) {
      return;
    }
    if (grouping) {
      grouping.push(step);
      return;
    }
    const { merge } = recordOptions;
    const at = now();
    const top = undoSteps[undoSteps.length - 1];
    const topMark = undoMarks[undoMarks.length - 1];
    if (
      merge !== undefined &&
      top?.merge === merge &&
      at - top.at <= mergeWindowMs &&
      (!topMark || topMark.serial < top.serial) &&
      positionNow() !== saved
    ) {
      // One step: undo goes back to before the first, redo to after the
      // last. A new serial, so the position moves and stays dirty.
      undoSteps[undoSteps.length - 1] = {
        serial: ++serial,
        step: { undo: top.step.undo, redo: step.redo },
        merge,
        at,
      };
      redoSteps = [];
      drawing?.clearRedo();
      notify();
      return;
    }
    undoSteps.push({ serial: ++serial, step, merge, at });
    redoSteps = [];
    // A new edit makes the drawing's redo entries unreachable too.
    drawing?.clearRedo();
    notify();
  };

  return {
    undo() {
      const step = undoSteps[undoSteps.length - 1];
      const mark = undoMarks[undoMarks.length - 1];
      if (mark && drawing && (!step || mark.serial > step.serial)) {
        // The drawing reports the move; onDrawingChange follows it.
        drawing.undo();
        return;
      }
      if (step) {
        undoSteps.pop();
        replay(() => step.step.undo());
        redoSteps.push(step);
        notify();
      }
    },
    redo() {
      const step = redoSteps[redoSteps.length - 1];
      const mark = redoMarks[redoMarks.length - 1];
      if (mark && drawing && (!step || mark.serial < step.serial)) {
        drawing.redo();
        return;
      }
      if (step) {
        redoSteps.pop();
        replay(() => step.step.redo());
        undoSteps.push(step);
        notify();
      }
    },
    get canUndo() {
      return undoSteps.length > 0 || undoMarks.length > 0;
    },
    get canRedo() {
      return redoSteps.length > 0 || redoMarks.length > 0;
    },
    get dirty() {
      return positionNow() !== saved;
    },
    get position() {
      return positionNow();
    },
    markSaved(at = positionNow()) {
      if (saved !== at) {
        saved = at;
        notify();
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    record,
    group(run) {
      if (grouping || replaying) {
        run();
        return;
      }
      const steps: HistoryStep[] = [];
      grouping = steps;
      try {
        run();
      } finally {
        grouping = null;
      }
      if (steps.length > 0) {
        record({
          undo: () => {
            for (let i = steps.length - 1; i >= 0; i--) {
              steps[i].undo();
            }
          },
          redo: () => {
            for (const s of steps) {
              s.redo();
            }
          },
        });
      }
    },
    attachDrawing(next) {
      const wasClean = positionNow() === saved;
      detachDrawing();
      detachDrawing = () => {};
      drawing = next;
      undoMarks = [];
      redoMarks = [];
      if (next) {
        // Entries made before this history saw the drawing: kept in the
        // order, never counted as edits.
        const { undo, redo } = next.depth();
        for (let i = 0; i < undo; i++) {
          undoMarks.push({ serial: ++serial, content: false });
        }
        for (let i = 0; i < redo; i++) {
          redoMarks.push({ serial: ++serial, content: false });
        }
        detachDrawing = next.subscribe(onDrawingChange);
      }
      if (wasClean) {
        saved = positionNow();
      }
      notify();
    },
    reset() {
      undoSteps = [];
      redoSteps = [];
      drawing?.clear();
      undoMarks = [];
      redoMarks = [];
      saved = positionNow();
      notify();
    },
  };
}

/** The history as the fork's `historyHost` prop asks for it. */
export function historyHost(history: History): HistoryHost {
  return {
    undo: () => history.undo(),
    redo: () => history.redo(),
    canUndo: () => history.canUndo,
    canRedo: () => history.canRedo,
    subscribe: (listener) => history.subscribe(listener),
  };
}
