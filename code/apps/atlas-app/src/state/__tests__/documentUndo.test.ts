// SPDX-License-Identifier: AGPL-3.0-only
//
// Document steps in the one history: each command the user gives is undone
// and redone through the History interface.

import { describe, expect, it } from "vitest";
import { defaultLayerStyle } from "@atlasdraw/basemap";
import * as Y from "yjs";

import { createHistory } from "../../session/history";
import {
  createDocument,
  createDocumentStore,
  type DocumentStore,
} from "../document";
import { followDocumentHistory } from "../documentUndo";

import type { FeatureCollection } from "geojson";

const points: FeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { name: "a" },
      geometry: { type: "Point", coordinates: [1, 2] },
    },
  ],
};

function setup(store: DocumentStore = createDocumentStore()) {
  const history = createHistory();
  const stop = followDocumentHistory(store, history);
  const doc = () => store.getState().doc;
  return { history, store, doc, stop };
}

function addLayer(
  doc: ReturnType<ReturnType<typeof setup>["doc"]>,
  id: string,
  label = id,
) {
  return doc.dispatch({
    type: "add-data-layer",
    id,
    fc: points,
    label,
    style: defaultLayerStyle(points),
  });
}

describe("document steps", () => {
  it("import a layer, restyle it, undo twice, redo", () => {
    const { history, doc } = setup();
    addLayer(doc(), "dl:a");
    doc().dispatch({ type: "restyle", id: "dl:a", patch: { opacity: 0.25 } });

    history.undo();
    const entry = doc()
      .snapshot()
      .overlays.find((e) => e.id === "dl:a");
    expect(entry?.kind === "data" && entry.style.opacity).not.toBe(0.25);

    history.undo();
    expect(doc().snapshot().overlays).toEqual([]);
    expect(doc().snapshot().featureCollections).toEqual({});

    history.redo();
    expect(
      doc()
        .snapshot()
        .overlays.map((e) => e.id),
    ).toEqual(["dl:a"]);
    expect(doc().snapshot().featureCollections["dl:a"]).toBe(points);
  });

  it("a slider dragged, or digits typed, is one step", () => {
    const { history, doc } = setup();
    addLayer(doc(), "dl:a");
    const before = doc().snapshot().overlays[0];
    for (const strokeWidth of [1, 12]) {
      doc().dispatch({ type: "restyle", id: "dl:a", patch: { strokeWidth } });
    }

    history.undo();
    expect(doc().snapshot().overlays[0]).toBe(before);
    history.redo();
    const after = doc().snapshot().overlays[0];
    expect(after.kind === "data" && after.style.strokeWidth).toBe(12);
  });

  it("undo of a delete puts the layer back where it was, with its payload", () => {
    const { history, doc } = setup();
    addLayer(doc(), "dl:a");
    addLayer(doc(), "dl:b");
    addLayer(doc(), "dl:c");
    doc().dispatch({ type: "set-visibility", id: "dl:b", visible: false });
    const before = doc().snapshot();

    doc().dispatch({ type: "remove-layer", id: "dl:b" });
    history.undo();

    const after = doc().snapshot();
    expect(after.overlays).toEqual(before.overlays);
    // The entry and the payload come back by identity: the map overlays find
    // an unchanged payload by identity.
    expect(after.overlays[1]).toBe(before.overlays[1]);
    expect(after.featureCollections["dl:b"]).toBe(points);
  });

  it("undoes a reorder, a rename, a visibility change and an opacity change", () => {
    const { history, doc } = setup();
    addLayer(doc(), "dl:a", "A");
    addLayer(doc(), "dl:b", "B");
    doc().dispatch({
      type: "add-tile-layer",
      id: "tl:t",
      label: "T",
      url: "https://tiles.example/{z}/{x}/{y}.png",
    });
    const start = doc().snapshot();

    doc().dispatch({ type: "reorder", id: "dl:a", order: 1 });
    doc().dispatch({ type: "rename-layer", id: "dl:b", label: "Bee" });
    doc().dispatch({ type: "set-visibility", id: "dl:a", visible: false });
    doc().dispatch({ type: "set-opacity", id: "tl:t", opacity: 0.5 });
    for (let i = 0; i < 4; i++) {
      history.undo();
    }

    expect(doc().snapshot().overlays).toEqual(start.overlays);
  });

  it("undoes the title and the basemap", () => {
    const { history, doc } = setup();
    const { title, basemap } = doc().snapshot();

    doc().dispatch({ type: "rename-document", title: "Rivers" });
    doc().dispatch({ type: "set-basemap", id: "protomaps-dark" });
    history.undo();
    history.undo();

    expect(doc().snapshot().title).toBe(title);
    expect(doc().snapshot().basemap).toBe(basemap);
  });

  it("a command that changes nothing, or is refused, is no step", () => {
    const { history, doc } = setup();
    doc().dispatch({ type: "rename-layer", id: "dl:none", label: "x" });
    const refused = doc().dispatch({
      type: "add-data-layer",
      id: "dl:bad",
      fc: points,
      label: "bad",
      style: { ...defaultLayerStyle(points), strokeWidth: -5 },
    });

    expect(refused.ok).toBe(false);
    expect(history.canUndo).toBe(false);
    expect(history.dirty).toBe(false);
  });

  it("a remote change is no step: undo stays per user", () => {
    const { history, doc } = setup();
    addLayer(doc(), "dl:mine");
    const mine = doc().snapshot();

    // A collaborator adds a layer and turns the basemap.
    doc().dispatch(
      {
        type: "replace-content",
        title: mine.title,
        overlays: [
          ...mine.overlays,
          { ...mine.overlays[0], id: "dl:theirs", order: 1 },
        ],
        featureCollections: { ...mine.featureCollections, "dl:theirs": points },
        images: mine.images,
      },
      "remote",
    );
    doc().dispatch({ type: "set-basemap", id: "protomaps-dark" }, "remote");

    history.undo();

    expect(
      doc()
        .snapshot()
        .overlays.map((e) => e.id),
    ).toEqual(["dl:theirs"]);
    expect(doc().snapshot().basemap).toBe("protomaps-dark");
    expect(history.canUndo).toBe(false);
  });

  it("a comment is a step", () => {
    const { history, doc } = setup();
    doc().comments.addComment({
      text: "Bridge is out",
      anchor: { kind: "map", lng: 1, lat: 2 },
      authorId: "u",
      authorName: "U",
    });
    expect(history.dirty).toBe(true);

    history.undo();
    expect(doc().comments.comments).toEqual([]);
    history.redo();
    expect(doc().comments.comments.map((c) => c.text)).toEqual([
      "Bridge is out",
    ]);
  });

  it("a collaborator's comment is no step", () => {
    const room = new Y.Doc();
    const store = createDocumentStore();
    store.setState({ doc: createDocument({}, undefined, room) });
    const { history, doc } = setup(store);

    const peer = new Y.Doc();
    const peerDoc = createDocument({}, undefined, peer);
    peerDoc.comments.addComment({
      text: "From a peer",
      anchor: { kind: "map", lng: 0, lat: 0 },
      authorId: "p",
      authorName: "P",
    });
    Y.applyUpdate(room, Y.encodeStateAsUpdate(peer), "relay");

    expect(doc().comments.comments).toHaveLength(1);
    expect(history.canUndo).toBe(false);
  });

  it("opening another document is not an edit, and its history starts empty", () => {
    const { history, doc, store } = setup();
    addLayer(doc(), "dl:a");
    expect(history.dirty).toBe(true);

    store.setState({ doc: createDocument() });

    expect(history.dirty).toBe(false);
    expect(history.canUndo).toBe(false);
    addLayer(doc(), "dl:b");
    history.undo();
    expect(doc().snapshot().overlays).toEqual([]);
  });

  it("stops following when stopped", () => {
    const { history, doc, stop } = setup();
    stop();
    addLayer(doc(), "dl:a");
    expect(history.canUndo).toBe(false);
  });
});
