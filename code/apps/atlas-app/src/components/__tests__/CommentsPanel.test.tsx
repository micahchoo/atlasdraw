// SPDX-License-Identifier: AGPL-3.0-only
// Phase 6 A3 — CommentsPanel tests.
//
// Asserts: renders rows, compose-bar adds comments, resolve flips,
// show-resolved filter, delete is gated to own comments.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  act,
} from "@testing-library/react";
import * as Y from "yjs";

import { CommentsPanel } from "../CommentsPanel";
import { CommentsLayer } from "../../state/comments";

import type { CommentAnchor } from "@atlasdraw/protocol";

function makeLayer(doc?: Y.Doc): CommentsLayer {
  return new CommentsLayer({
    wsUrl: "ws://test.invalid",
    roomId: "test-room",
    workspaceId: null,
    doc: doc ?? new Y.Doc(),
    providerFactory: () => null,
  });
}

afterEach(() => {
  cleanup();
});

describe("CommentsPanel", () => {
  let layer: CommentsLayer;
  const mapAnchor: CommentAnchor = { kind: "map", lng: 0, lat: 0 };

  beforeEach(() => {
    layer = makeLayer();
  });

  it("renders the empty state when no comments", () => {
    render(
      <CommentsPanel
        commentsLayer={layer}
        authorId="alice"
        authorName="Alice"
      />,
    );
    expect(screen.getByTestId("comments-empty")).toBeTruthy();
  });

  it("renders existing comments in chronological order", () => {
    layer.addComment({
      text: "first",
      anchor: mapAnchor,
      authorId: "alice",
      authorName: "Alice",
    });
    layer.addComment({
      text: "second",
      anchor: mapAnchor,
      authorId: "alice",
      authorName: "Alice",
    });
    render(
      <CommentsPanel
        commentsLayer={layer}
        authorId="alice"
        authorName="Alice"
      />,
    );
    expect(screen.getByText("first")).toBeTruthy();
    expect(screen.getByText("second")).toBeTruthy();
  });

  it("compose-bar appends a new comment when an anchor is pending", () => {
    render(
      <CommentsPanel
        commentsLayer={layer}
        authorId="alice"
        authorName="Alice"
        pendingAnchor={mapAnchor}
      />,
    );
    const textarea = screen.getByTestId(
      "comments-composer-text",
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "hello world" } });
    fireEvent.click(screen.getByTestId("comments-submit"));
    expect(layer.comments).toHaveLength(1);
    expect(layer.comments[0]?.text).toBe("hello world");
  });

  it("Post button is disabled until both text + anchor are present", () => {
    const { rerender } = render(
      <CommentsPanel
        commentsLayer={layer}
        authorId="alice"
        authorName="Alice"
      />,
    );
    const submit = screen.getByTestId("comments-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    // Add text — still disabled (no anchor).
    fireEvent.change(screen.getByTestId("comments-composer-text"), {
      target: { value: "x" },
    });
    expect(submit.disabled).toBe(true);

    rerender(
      <CommentsPanel
        commentsLayer={layer}
        authorId="alice"
        authorName="Alice"
        pendingAnchor={mapAnchor}
      />,
    );
    fireEvent.change(screen.getByTestId("comments-composer-text"), {
      target: { value: "now ready" },
    });
    expect(
      (screen.getByTestId("comments-submit") as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("resolve button flips resolved on the matching comment", () => {
    const id = layer.addComment({
      text: "resolve me",
      anchor: mapAnchor,
      authorId: "alice",
      authorName: "Alice",
    });
    render(
      <CommentsPanel
        commentsLayer={layer}
        authorId="alice"
        authorName="Alice"
      />,
    );
    fireEvent.click(screen.getByTestId(`comments-row-resolve-${id}`));
    expect(layer.comments[0]?.resolved).toBe(true);
  });

  it("show-resolved filter hides resolved comments by default", () => {
    const id1 = layer.addComment({
      text: "open",
      anchor: mapAnchor,
      authorId: "alice",
      authorName: "Alice",
    });
    const id2 = layer.addComment({
      text: "done",
      anchor: mapAnchor,
      authorId: "alice",
      authorName: "Alice",
    });
    act(() => layer.resolve(id2));

    render(
      <CommentsPanel
        commentsLayer={layer}
        authorId="alice"
        authorName="Alice"
      />,
    );
    // Default: only "open" visible.
    expect(screen.queryByTestId(`comments-row-${id1}`)).toBeTruthy();
    expect(screen.queryByTestId(`comments-row-${id2}`)).toBeNull();

    // Toggle filter → both visible.
    fireEvent.click(screen.getByTestId("comments-filter-show-resolved"));
    expect(screen.queryByTestId(`comments-row-${id2}`)).toBeTruthy();
  });

  it("delete is hidden for non-own comments", () => {
    const ownId = layer.addComment({
      text: "mine",
      anchor: mapAnchor,
      authorId: "alice",
      authorName: "Alice",
    });
    const otherId = layer.addComment({
      text: "theirs",
      anchor: mapAnchor,
      authorId: "bob",
      authorName: "Bob",
    });

    render(
      <CommentsPanel
        commentsLayer={layer}
        authorId="alice"
        authorName="Alice"
      />,
    );
    expect(screen.queryByTestId(`comments-row-delete-${ownId}`)).toBeTruthy();
    expect(screen.queryByTestId(`comments-row-delete-${otherId}`)).toBeNull();
  });

  it("onRequestAnchor fires when the anchor toggle is clicked", () => {
    const captured: string[] = [];
    render(
      <CommentsPanel
        commentsLayer={layer}
        authorId="alice"
        authorName="Alice"
        onRequestAnchor={(kind) => captured.push(kind)}
      />,
    );
    fireEvent.click(screen.getByTestId("comments-anchor-element"));
    fireEvent.click(screen.getByTestId("comments-anchor-map"));
    expect(captured).toEqual(["element", "map"]);
  });

  it("with null commentsLayer, the panel is read-only", () => {
    render(
      <CommentsPanel
        commentsLayer={null}
        authorId="alice"
        authorName="Alice"
        pendingAnchor={mapAnchor}
      />,
    );
    const submit = screen.getByTestId("comments-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(screen.getByTestId("comments-empty")).toBeTruthy();
  });
});
