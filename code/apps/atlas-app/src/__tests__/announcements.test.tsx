// SPDX-License-Identifier: AGPL-3.0-only
// Phase 6 A14b — surface-level announcement tests.
//
// Asserts:
//  - Toggling layer visibility in LayerPanel triggers an aria-live
//    announcement.
//  - A new comment delta on CommentsLayer triggers an announcement via
//    subscribeAdditions.
//  - Comments present at sync-window construction do NOT announce (replay
//    guard).

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type { FeatureCollection } from "geojson";
import * as Y from "yjs";

import { AriaAnnouncer, useAnnouncerStore } from "../components/AriaAnnouncer";
import { LayerPanel } from "../components/LayerPanel";
import { CommentsLayer } from "../state/comments";
import { useLayerRegistryStore } from "../state/layerRegistry";
import type { CommentAnchor } from "@atlasdraw/protocol";

const emptyFc = (count: number): FeatureCollection => ({
  type: "FeatureCollection",
  features: Array.from({ length: count }, () => ({
    type: "Feature",
    properties: {},
    geometry: { type: "Point", coordinates: [0, 0] },
  })),
});

beforeEach(() => {
  useLayerRegistryStore.setState({ entries: [] });
  useAnnouncerStore.setState({ message: "", seq: 0 });
});

afterEach(() => {
  cleanup();
});

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 5));
  });
}

describe("aria-live: layer-visibility toggle", () => {
  it("toggling a data layer's visibility emits an announcement", async () => {
    useLayerRegistryStore.getState().registerDataLayer({
      id: "dl:test-1",
      fc: emptyFc(1),
      label: "Roads",
      style: { fillColor: "#ff0000", opacity: 1 },
    });

    render(
      <>
        <LayerPanel />
        <AriaAnnouncer />
      </>,
    );

    // Pre-state: layer is visible. Click the eye → hide.
    fireEvent.click(screen.getByTestId("layer-visibility-dl:test-1"));
    await flush();
    expect(screen.getByTestId("aria-announcer").textContent).toContain(
      'Layer "Roads"',
    );
    expect(screen.getByTestId("aria-announcer").textContent).toContain("hidden");

    // Click again → show.
    fireEvent.click(screen.getByTestId("layer-visibility-dl:test-1"));
    await flush();
    expect(screen.getByTestId("aria-announcer").textContent).toContain("shown");
  });
});

describe("aria-live: new comment", () => {
  const mapAnchor: CommentAnchor = { kind: "map", lng: 0, lat: 0 };

  function makeLayer(): CommentsLayer {
    return new CommentsLayer({
      wsUrl: "ws://test.invalid",
      roomId: "test-room",
      workspaceId: null,
      providerFactory: () => null,
    });
  }

  it("subscribeAdditions fires for a comment added AFTER sync window", async () => {
    const layer = makeLayer();
    const seen: string[] = [];
    layer.subscribeAdditions((c) => seen.push(c.authorName));

    layer.addComment({
      text: "hello",
      anchor: mapAnchor,
      authorId: "alice",
      authorName: "Alice",
    });
    // Yjs observeDeep is synchronous.
    expect(seen).toEqual(["Alice"]);
  });

  it("subscribeAdditions does NOT fire for the same id twice", () => {
    const layer = makeLayer();
    const seen: string[] = [];
    layer.subscribeAdditions((c) => seen.push(c.id));
    const id = layer.addComment({
      text: "x",
      anchor: mapAnchor,
      authorId: "a",
      authorName: "A",
    });
    // Re-resolve (a mutation that fires observeDeep again) must not re-announce.
    layer.resolve(id);
    expect(seen.length).toBe(1);
  });

  it("comments present BEFORE construction never announce (sync-window guard)", () => {
    // Use a single Y.Doc; pre-seed the array directly, then construct the
    // CommentsLayer to observe it. The pre-existing comment must NOT trigger
    // an addition listener.
    const doc = new Y.Doc();
    // Key must match COMMENTS_ARRAY_KEY in @atlasdraw/protocol = "comments".
    const arr = doc.getArray<Y.Map<unknown>>("comments");
    const m = new Y.Map<unknown>();
    const anchorMap = new Y.Map<unknown>();
    anchorMap.set("kind", "map");
    anchorMap.set("lng", 0);
    anchorMap.set("lat", 0);
    m.set("id", "pre-1");
    m.set("authorId", "x");
    m.set("authorName", "X");
    m.set("text", "pre-existing");
    m.set("createdAt", Date.now());
    m.set("anchor", anchorMap);
    m.set("resolved", false);
    m.set("schemaVersion", 1);
    arr.push([m]);

    const layer = new CommentsLayer({
      wsUrl: "ws://test.invalid",
      roomId: "shared-room",
      workspaceId: null,
      doc,
      providerFactory: () => null,
    });
    const seen: string[] = [];
    layer.subscribeAdditions((c) => seen.push(c.authorName));

    // Initial snapshot contains "X" but the subscriber, attached AFTER
    // construction, never sees an announcement for it (it was registered in
    // _announcedIds at construction time).
    expect(layer.comments.length).toBe(1);
    expect(seen).toEqual([]);
  });
});
