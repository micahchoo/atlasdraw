import { describe, it, expect } from "vitest";
import type { AtlasdrawTool, ToolContext, ToolPointerEvent } from "./types.js";

describe("AtlasdrawTool interface shape", () => {
  it("a minimal valid tool implementation compiles", () => {
    const myTool: AtlasdrawTool = {
      id: "test",
      label: "Test",
      icon: "test-icon",
      cursor: "crosshair",
      defaultScaleMode: "screen",
      onPointerDown(_e: ToolPointerEvent, _ctx: ToolContext) {
        // no-op
      },
    };
    expect(myTool.id).toBe("test");
  });

  it("optional handlers can be omitted", () => {
    const minimal: AtlasdrawTool = {
      id: "minimal",
      label: "M",
      icon: "i",
      cursor: "default",
      defaultScaleMode: "geographic",
      onPointerDown: () => {},
    };
    expect(minimal.onPointerMove).toBeUndefined();
    expect(minimal.onActivate).toBeUndefined();
  });
});
