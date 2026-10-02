// SPDX-License-Identifier: AGPL-3.0-only
//
// One history over two sources, through the History interface. The drawing
// is a fake with the shape of the fork's `api.history`: two stacks of named
// entries, and a change event for each move.

import { describe, expect, it, vi } from "vitest";

import type { HistoryChange } from "@atlasdraw/excalidraw/types";

import { createHistory, type DrawingHistory } from "./history";

/** A drawing history: its entries are strings, newest last. */
function fakeDrawing() {
  const undoStack: string[] = [];
  const redoStack: string[] = [];
  const listeners = new Set<(change: HistoryChange) => void>();
  const emit = (change: HistoryChange) => {
    for (const l of Array.from(listeners)) {
      l(change);
    }
  };
  const done: string[] = [];
  const drawing: DrawingHistory & {
    /** The user draws (elements) or selects (no elements). */
    draw(name: string, elements?: boolean): void;
    done: string[];
  } = {
    done,
    draw(name, elements = true) {
      undoStack.push(name);
      if (elements) {
        redoStack.length = 0;
      }
      emit({ kind: "record", elements });
    },
    undo() {
      const name = undoStack.pop();
      if (name) {
        redoStack.push(name);
        done.push(`undo ${name}`);
      }
      emit({ kind: "undo" });
    },
    redo() {
      const name = redoStack.pop();
      if (name) {
        undoStack.push(name);
        done.push(`redo ${name}`);
      }
      emit({ kind: "redo" });
    },
    depth: () => ({ undo: undoStack.length, redo: redoStack.length }),
    clearRedo() {
      redoStack.length = 0;
      emit({ kind: "clear-redo" });
    },
    clear() {
      undoStack.length = 0;
      redoStack.length = 0;
      emit({ kind: "clear" });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return drawing;
}

/** A document step that writes what it does into `log`. */
function step(name: string, log: string[]) {
  return {
    undo: () => log.push(`undo ${name}`),
    redo: () => log.push(`redo ${name}`),
  };
}

function setup() {
  const history = createHistory();
  const drawing = fakeDrawing();
  history.attachDrawing(drawing);
  // One log for both sources, in the order things happen.
  const log = drawing.done;
  return { history, drawing, log };
}

describe("History: one order over two sources", () => {
  it("undo calls whichever source owns the newest entry", () => {
    const { history, drawing, log } = setup();
    history.record(step("import", log));
    drawing.draw("rectangle");
    history.record(step("restyle", log));

    history.undo();
    history.undo();
    history.undo();

    expect(log).toEqual(["undo restyle", "undo rectangle", "undo import"]);
    expect(history.canUndo).toBe(false);
  });

  it("redo goes back in the order undo left", () => {
    const { history, drawing, log } = setup();
    history.record(step("import", log));
    drawing.draw("rectangle");
    history.record(step("restyle", log));
    history.undo();
    history.undo();
    history.undo();
    log.length = 0;

    history.redo();
    history.redo();
    history.redo();

    expect(log).toEqual(["redo import", "redo rectangle", "redo restyle"]);
    expect(history.canRedo).toBe(false);
  });

  it("a new document step clears both redo stacks", () => {
    const { history, drawing, log } = setup();
    drawing.draw("rectangle");
    history.record(step("import", log));
    history.undo();
    history.undo();
    expect(history.canRedo).toBe(true);

    history.record(step("rename", log));

    expect(history.canRedo).toBe(false);
    expect(drawing.depth().redo).toBe(0);
  });

  it("a new drawing step clears the document's redo; a selection does not", () => {
    const { history, drawing, log } = setup();
    history.record(step("import", log));
    history.undo();

    drawing.draw("select", false);
    expect(history.canRedo).toBe(true);

    drawing.draw("rectangle");
    expect(history.canRedo).toBe(false);
  });

  it("a group is one step", () => {
    const { history, log } = setup();
    history.group(() => {
      history.record(step("add layer", log));
      history.record(step("delete shape", log));
    });

    history.undo();
    expect(log).toEqual(["undo delete shape", "undo add layer"]);
    expect(history.canUndo).toBe(false);

    history.redo();
    expect(log.slice(2)).toEqual(["redo add layer", "redo delete shape"]);
  });

  it("steps with one merge key, close in time, are one step", () => {
    let t = 0;
    const history = createHistory({ now: () => t });
    const log: string[] = [];
    history.record(step("width 1", log), { merge: "width" });
    t += 300;
    history.record(step("width 12", log), { merge: "width" });

    history.undo();
    expect(log).toEqual(["undo width 1"]);
    expect(history.canUndo).toBe(false);
    history.redo();
    expect(log).toEqual(["undo width 1", "redo width 12"]);
  });

  it("a merge key does not reach across a pause, another key, or a save", () => {
    let t = 0;
    const history = createHistory({ now: () => t });
    const log: string[] = [];
    history.record(step("a", log), { merge: "width" });
    t += 5000;
    history.record(step("b", log), { merge: "width" });
    history.record(step("c", log), { merge: "fill" });
    history.markSaved();
    history.record(step("d", log), { merge: "fill" });
    expect(history.dirty).toBe(true);

    for (let i = 0; i < 4; i++) {
      history.undo();
    }
    expect(log).toEqual(["undo d", "undo c", "undo b", "undo a"]);
  });

  it("a step does not record what its own undo or redo does", () => {
    const { history } = setup();
    let inner = 0;
    history.record({
      undo: () => {
        history.record({ undo: () => inner++, redo: () => inner++ });
      },
      redo: () => {},
    });

    history.undo();

    expect(history.canUndo).toBe(false);
    expect(inner).toBe(0);
  });

  it("tells a subscriber when it changes", () => {
    const { history, drawing, log } = setup();
    const listener = vi.fn();
    history.subscribe(listener);

    for (const change of [
      () => history.record(step("import", log)),
      () => drawing.draw("rectangle"),
      () => history.undo(),
    ]) {
      listener.mockClear();
      change();
      expect(listener).toHaveBeenCalled();
    }
  });
});

describe("History: dirty is the position against the saved position", () => {
  it("a new history is clean; an edit makes it dirty; a save, clean", () => {
    const { history, drawing, log } = setup();
    expect(history.dirty).toBe(false);

    history.record(step("import", log));
    expect(history.dirty).toBe(true);
    history.markSaved();
    expect(history.dirty).toBe(false);

    drawing.draw("rectangle");
    expect(history.dirty).toBe(true);
    history.markSaved();
    expect(history.dirty).toBe(false);
  });

  it("undo past the save is dirty, and redo back to it is clean", () => {
    const { history, drawing, log } = setup();
    history.record(step("import", log));
    drawing.draw("rectangle");
    history.markSaved();

    history.undo();
    expect(history.dirty).toBe(true);
    history.undo();
    expect(history.dirty).toBe(true);
    history.redo();
    history.redo();
    expect(history.dirty).toBe(false);
  });

  it("a new edit after undo past the save stays dirty when undone to the same depth", () => {
    const { history, log } = setup();
    history.record(step("import", log));
    history.markSaved();
    history.undo();
    history.record(step("rename", log));
    history.undo();

    // Same number of steps as at the save, but not the saved content.
    history.record(step("restyle", log));
    expect(history.dirty).toBe(true);
  });

  it("a selection is not an edit", () => {
    const { history, drawing } = setup();
    drawing.draw("select", false);
    expect(history.dirty).toBe(false);
    history.undo();
    expect(history.dirty).toBe(false);
  });

  it("a save marks the position it started from, not the edits made while it ran", () => {
    const { history, drawing, log } = setup();
    history.record(step("import", log));
    const started = history.position;
    drawing.draw("rectangle");

    history.markSaved(started);

    expect(history.dirty).toBe(true);
  });

  it("reset forgets every step, empties the drawing's history, and is clean", () => {
    const { history, drawing, log } = setup();
    history.record(step("import", log));
    drawing.draw("rectangle");

    history.reset();

    expect(history.dirty).toBe(false);
    expect(history.canUndo).toBe(false);
    expect(drawing.depth()).toEqual({ undo: 0, redo: 0 });
  });

  it("the drawing's own clear keeps a clean history clean and a dirty one dirty", () => {
    const { history, drawing, log } = setup();
    drawing.draw("rectangle");
    history.markSaved();
    drawing.clear();
    expect(history.dirty).toBe(false);

    history.record(step("import", log));
    drawing.draw("ellipse");
    drawing.clear();
    expect(history.dirty).toBe(true);
  });
});
