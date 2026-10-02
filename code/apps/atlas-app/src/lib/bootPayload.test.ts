import { describe, expect, it } from "vitest";

import { checkBudgets, routePayload, type Manifest } from "./bootPayload";

// A manifest in the shape `vite build --manifest` writes: the page entry
// imports a shared chunk statically and each route root dynamically.
const MANIFEST: Manifest = {
  "index.html": {
    file: "assets/index.js",
    isEntry: true,
    imports: ["_react.js"],
    dynamicImports: ["_MapEditor-x.js", "src/components/View.tsx"],
    css: ["assets/index.css"],
  },
  "_react.js": { file: "assets/react.js" },
  // Vite files a route root that another chunk also imports under a
  // shared-chunk key; only its `name` says what it is.
  "_MapEditor-x.js": {
    file: "assets/MapEditor.js",
    name: "MapEditor",
    isDynamicEntry: true,
    imports: ["index.html", "_fork.js", "_react.js"],
    dynamicImports: ["src/lib/export.ts"],
    css: ["assets/MapEditor.css"],
  },
  "src/components/View.tsx": {
    file: "assets/View.js",
    name: "View",
    isDynamicEntry: true,
    imports: ["_fork.js"],
  },
  "_fork.js": { file: "assets/fork.js", imports: ["_react.js"] },
  "src/lib/export.ts": {
    file: "assets/export.js",
    isDynamicEntry: true,
    imports: ["_pdf.js"],
  },
  "_pdf.js": { file: "assets/pdf.js" },
};

describe("routePayload", () => {
  it("is the page entry and the route root with every static import, once each", () => {
    expect(routePayload(MANIFEST, "MapEditor")).toEqual([
      "assets/index.js",
      "assets/index.css",
      "assets/react.js",
      "assets/MapEditor.js",
      "assets/MapEditor.css",
      "assets/fork.js",
    ]);
  });

  it("leaves out what the route loads on demand", () => {
    const files = routePayload(MANIFEST, "MapEditor");
    expect(files).not.toContain("assets/export.js");
    expect(files).not.toContain("assets/pdf.js");
  });

  it("finds a route root by its chunk name", () => {
    expect(routePayload(MANIFEST, "View")).toContain("assets/View.js");
  });

  it("names a route root the build does not have", () => {
    expect(() => routePayload(MANIFEST, "Gone")).toThrow(/Gone/);
  });
});

describe("checkBudgets", () => {
  it("fails a route over its budget and passes one under it", () => {
    const sizes = { editor: 900_000, viewer: 100_000 };
    const result = checkBudgets(sizes, { editor: 800_000, viewer: 120_000 });
    expect(result.map((r) => [r.route, r.pass])).toEqual([
      ["editor", false],
      ["viewer", true],
    ]);
  });

  it("fails a route that has no budget, so a new route cannot go unmeasured", () => {
    const [row] = checkBudgets({ atlas: 1 }, {});
    expect(row.pass).toBe(false);
  });
});
