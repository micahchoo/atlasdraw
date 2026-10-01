// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";

import { relativeTime } from "./relativeTime";

const NOW = Date.parse("2026-10-01T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe("relativeTime", () => {
  it.each([
    [10_000, "just now"],
    [5 * 60_000, "5 minutes ago"],
    [60 * 60_000, "1 hour ago"],
    [26 * 3_600_000, "yesterday"],
    [3 * 86_400_000, "3 days ago"],
    [45 * 86_400_000, "last month"],
    [800 * 86_400_000, "2 years ago"],
  ])("%d ms before now reads %s", (ms, text) => {
    expect(relativeTime(ago(ms), NOW, "en")).toBe(text);
  });

  it("reads a time in the future as just now", () => {
    expect(relativeTime(ago(-60_000), NOW, "en")).toBe("just now");
  });
});
