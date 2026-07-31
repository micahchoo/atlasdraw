// SPDX-License-Identifier: AGPL-3.0-only
// `useCommentSearchSources` — the atlas-app half of comment search.
//
// The vendored half (packages/excalidraw/tests/searchSources.test.tsx) pins
// what the editor does with a source. This pins what we put in one: which
// comments are offered, and what picking a hit actually moves.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import * as Y from "yjs";

import type { ExcalidrawImperativeAPI } from "@atlasdraw/excalidraw/types";

import { CommentsLayer } from "../state/comments";
import {
  __resetForTest as resetCommentFocus,
  getCommentFocus,
} from "../state/commentFocus";

import { useCommentSearchSources } from "./useCommentSearchSources";

import type maplibregl from "maplibre-gl";

function makeLayer(): CommentsLayer {
  return new CommentsLayer({
    wsUrl: "ws://test.invalid",
    roomId: "test-room",
    workspaceId: null,
    doc: new Y.Doc(),
    providerFactory: () => null,
  });
}

const author = { authorId: "alice", authorName: "Alice" };

// Only the two methods the hook reaches for; the rest of both APIs is
// irrelevant here and stubbing it would just be a second thing to keep true.
const makeMap = () => ({ flyTo: vi.fn() } as unknown as maplibregl.Map);
const makeAPI = () =>
  ({ scrollToContent: vi.fn() } as unknown as ExcalidrawImperativeAPI);

let layer: CommentsLayer;
let map: maplibregl.Map;
let excalidrawAPI: ExcalidrawImperativeAPI;

const mount = () =>
  renderHook(() =>
    useCommentSearchSources({ commentsLayer: layer, map, excalidrawAPI }),
  );

beforeEach(() => {
  resetCommentFocus();
  layer = makeLayer();
  map = makeMap();
  excalidrawAPI = makeAPI();
});

afterEach(cleanup);

describe("useCommentSearchSources", () => {
  it("offers nothing when there is no comments layer", () => {
    const { result } = renderHook(() =>
      useCommentSearchSources({
        commentsLayer: null,
        map,
        excalidrawAPI,
      }),
    );
    // `undefined`, not `[]` — the editor skips the whole source path.
    expect(result.current).toBeUndefined();
  });

  it("offers nothing when every comment is resolved", () => {
    layer.addComment({
      text: "done and dusted",
      anchor: { kind: "map", lng: 1, lat: 2 },
      ...author,
    });
    layer.resolve(layer.comments[0].id);

    expect(mount().result.current).toBeUndefined();
  });

  it("offers one Comments source holding the open threads' text", () => {
    layer.addComment({
      text: "levee looks low here",
      anchor: { kind: "map", lng: 1, lat: 2 },
      ...author,
    });
    layer.addComment({
      text: "already handled",
      anchor: { kind: "map", lng: 3, lat: 4 },
      ...author,
    });
    layer.resolve(layer.comments[1].id);

    const sources = mount().result.current;
    expect(sources).toHaveLength(1);
    expect(sources![0].label).toBe("Comments");
    // Resolved threads are closed business — CommentsPanel hides them by
    // default and the canvas overlay drops them, so search must agree.
    expect(sources![0].entries.map((e) => e.text)).toEqual([
      "levee looks low here",
    ]);
  });

  it("tracks comments arriving after mount", () => {
    const { result } = mount();
    expect(result.current).toBeUndefined();

    act(() => {
      layer.addComment({
        text: "arrived late",
        anchor: { kind: "map", lng: 1, lat: 2 },
        ...author,
      });
    });

    expect(result.current?.[0].entries.map((e) => e.text)).toEqual([
      "arrived late",
    ]);
  });

  it("flies the map to a map anchor and opens that comment", () => {
    layer.addComment({
      text: "here",
      anchor: { kind: "map", lng: -122.68, lat: 45.52 },
      ...author,
    });
    const commentId = layer.comments[0].id;

    mount().result.current![0].entries[0].onSelect();

    expect(map.flyTo).toHaveBeenCalledWith({ center: [-122.68, 45.52] });
    expect(excalidrawAPI.scrollToContent).not.toHaveBeenCalled();
    expect(getCommentFocus()?.commentId).toBe(commentId);
  });

  it("scrolls the editor to an element anchor and opens that comment", () => {
    layer.addComment({
      text: "here",
      anchor: { kind: "annotation", source: "element", elementId: "el-7" },
      ...author,
    });
    const commentId = layer.comments[0].id;

    mount().result.current![0].entries[0].onSelect();

    expect(excalidrawAPI.scrollToContent).toHaveBeenCalledWith("el-7", {
      fitToContent: true,
      animate: true,
    });
    expect(map.flyTo).not.toHaveBeenCalled();
    expect(getCommentFocus()?.commentId).toBe(commentId);
  });

  it("bumps the focus nonce on a repeat pick, so a closed popover re-opens", () => {
    layer.addComment({
      text: "here",
      anchor: { kind: "map", lng: 0, lat: 0 },
      ...author,
    });

    const select = mount().result.current![0].entries[0].onSelect;
    select();
    const first = getCommentFocus()!.nonce;
    select();

    expect(getCommentFocus()!.nonce).toBeGreaterThan(first);
  });
});
