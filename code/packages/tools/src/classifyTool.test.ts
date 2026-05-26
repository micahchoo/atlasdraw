import { describe, it, expect } from "vitest";

import { classifyTool } from "./classifyTool.js";

describe("classifyTool", () => {
  describe("pass-through tools (isDrawingMode = false)", () => {
    it("hand → false (map pan/zoom should work)", () => {
      expect(classifyTool("hand")).toBe(false);
    });
  });

  describe("drawing tools (isDrawingMode = true)", () => {
    it("selection → true (clicks geo-elements; per atlasdraw-dd91)", () => {
      expect(classifyTool("selection")).toBe(true);
    });

    it("rectangle → true", () => {
      expect(classifyTool("rectangle")).toBe(true);
    });

    it("ellipse → true", () => {
      expect(classifyTool("ellipse")).toBe(true);
    });

    it("freedraw → true", () => {
      expect(classifyTool("freedraw")).toBe(true);
    });

    it("lasso → true (per Phase 1 plan literal)", () => {
      expect(classifyTool("lasso")).toBe(true);
    });

    it("diamond → true", () => {
      expect(classifyTool("diamond")).toBe(true);
    });

    it("arrow → true", () => {
      expect(classifyTool("arrow")).toBe(true);
    });

    it("line → true", () => {
      expect(classifyTool("line")).toBe(true);
    });

    it("text → true", () => {
      expect(classifyTool("text")).toBe(true);
    });

    it("image → true", () => {
      expect(classifyTool("image")).toBe(true);
    });

    it("eraser → true", () => {
      expect(classifyTool("eraser")).toBe(true);
    });

    it("frame → true", () => {
      expect(classifyTool("frame")).toBe(true);
    });

    it("laser → true", () => {
      expect(classifyTool("laser")).toBe(true);
    });

    it("custom → true", () => {
      expect(classifyTool("custom")).toBe(true);
    });
  });
});
