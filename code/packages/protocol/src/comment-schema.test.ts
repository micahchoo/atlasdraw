// SPDX-License-Identifier: MIT
// @atlasdraw/protocol — comment-schema unit tests.

import { describe, it, expect } from "vitest";

import {
  buildCommentsDocPath,
  COMMENT_SCHEMA_VERSION,
  COMMENTS_ARRAY_KEY,
} from "./comment-schema";

describe("comment-schema", () => {
  it("exports a stable schema version literal", () => {
    expect(COMMENT_SCHEMA_VERSION).toBe(1);
  });

  it("exports the canonical Y.Array key", () => {
    expect(COMMENTS_ARRAY_KEY).toBe("comments");
  });

  describe("buildCommentsDocPath", () => {
    it("returns /yjs/comments/<roomId> when workspaceId is null", () => {
      expect(buildCommentsDocPath("room-abc", null)).toBe(
        "/yjs/comments/room-abc",
      );
    });

    it("returns /yjs/comments/<workspaceId>/<roomId> when workspaceId is set", () => {
      expect(buildCommentsDocPath("room-abc", "ws-1")).toBe(
        "/yjs/comments/ws-1/room-abc",
      );
    });

    it("treats empty-string workspaceId as null (no scoping prefix)", () => {
      expect(buildCommentsDocPath("room-abc", "")).toBe(
        "/yjs/comments/room-abc",
      );
    });

    it("workspace-scoped paths for the same roomId across workspaces differ", () => {
      const a = buildCommentsDocPath("room-abc", "ws-alpha");
      const b = buildCommentsDocPath("room-abc", "ws-beta");
      expect(a).not.toBe(b);
    });
  });
});
