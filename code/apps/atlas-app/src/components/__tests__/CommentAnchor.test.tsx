// SPDX-License-Identifier: AGPL-3.0-only
// Phase 6 A3 — CommentAnchor tests.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";

import {
  COMMENT_SCHEMA_VERSION,
  type CommentAnchor as CommentAnchorKind,
} from "@atlasdraw/protocol";

import { CommentAnchor } from "../CommentAnchor";

import type { Comment } from "../../state/comments";

function makeComment(
  overrides: Partial<Comment> = {},
  anchor: CommentAnchorKind = { kind: "map", lng: 0, lat: 0 },
): Comment {
  return {
    id: overrides.id ?? "c1",
    authorId: "alice",
    authorName: "Alice",
    text: "hello",
    createdAt: 1_700_000_000_000,
    anchor,
    resolved: false,
    schemaVersion: COMMENT_SCHEMA_VERSION,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe("CommentAnchor", () => {
  it("renders at the provided projected coordinates (map anchor)", () => {
    const c = makeComment();
    render(<CommentAnchor comment={c} screenX={120} screenY={80} />);
    const node = screen.getByTestId(`comment-anchor-${c.id}`) as HTMLElement;
    expect(node.style.left).toBe("120px");
    expect(node.style.top).toBe("80px");
    expect(node.getAttribute("data-anchor-kind")).toBe("map");
  });

  it("renders with element-anchor data attribute", () => {
    const c = makeComment({ id: "c2" }, { kind: "element", elementId: "el-1" });
    render(<CommentAnchor comment={c} screenX={10} screenY={20} />);
    const node = screen.getByTestId(`comment-anchor-${c.id}`) as HTMLElement;
    expect(node.getAttribute("data-anchor-kind")).toBe("element");
  });

  it("click opens a popover with the comment text", () => {
    const c = makeComment({ id: "c3", text: "popover content" });
    render(<CommentAnchor comment={c} screenX={0} screenY={0} />);
    expect(screen.queryByTestId(`comment-popover-${c.id}`)).toBeNull();
    fireEvent.click(screen.getByTestId(`comment-anchor-button-${c.id}`));
    const pop = screen.getByTestId(`comment-popover-${c.id}`);
    expect(pop).toBeTruthy();
    expect(pop.textContent).toContain("popover content");
  });

  it("Resolve button in popover invokes onResolve with the comment id", () => {
    const c = makeComment({ id: "c4" });
    const onResolve = vi.fn();
    render(
      <CommentAnchor
        comment={c}
        screenX={0}
        screenY={0}
        onResolve={onResolve}
      />,
    );
    fireEvent.click(screen.getByTestId(`comment-anchor-button-${c.id}`));
    fireEvent.click(screen.getByTestId(`comment-popover-resolve-${c.id}`));
    expect(onResolve).toHaveBeenCalledWith("c4");
  });

  it("resolved comments do not show a Resolve action in the popover", () => {
    const c = makeComment({ id: "c5", resolved: true });
    render(
      <CommentAnchor
        comment={c}
        screenX={0}
        screenY={0}
        onResolve={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId(`comment-anchor-button-${c.id}`));
    expect(screen.queryByTestId(`comment-popover-resolve-${c.id}`)).toBeNull();
  });
});
