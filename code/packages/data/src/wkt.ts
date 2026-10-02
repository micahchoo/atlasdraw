// SPDX-License-Identifier: MIT
// packages/data/src/wkt.ts
// Well-Known Text → GeoJSON geometry.
//
// Pure module. It reads the WKT that export.ts `toWKT` writes, and the forms
// GIS programs put in a CSV column: any case, an EWKT `SRID=n;` prefix, and
// Z, M and ZM coordinates. An M value is not kept. The SRID is not read:
// coordinates.ts decides what the numbers are, as for every other format.
//
// A text that is not one geometry gives null, never a throw: the CSV reader
// skips the row and counts it.

import type { Geometry, Position } from "geojson";

/**
 * The deepest GEOMETRYCOLLECTION nesting read. A cell of a 50 MB file can
 * nest far deeper than the call stack; deeper text is not a geometry.
 */
const MAX_DEPTH = 32;

/** Thrown inside the reader only; `parseWKT` turns it into null. */
class NotWkt extends Error {}

const NUMBER = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/y;
const WORD = /[A-Za-z]+/y;
const SPACE = /\s*/y;
const SRID = /^\s*SRID=\d+;/i;

type Dimensions = "" | "Z" | "M" | "ZM";

class Reader {
  private at = 0;

  constructor(private readonly text: string) {}

  private skipSpace(): void {
    SPACE.lastIndex = this.at;
    SPACE.exec(this.text);
    this.at = SPACE.lastIndex;
  }

  private match(pattern: RegExp): string | null {
    this.skipSpace();
    pattern.lastIndex = this.at;
    const found = pattern.exec(this.text);
    if (!found) {
      return null;
    }
    this.at = pattern.lastIndex;
    return found[0];
  }

  /** Consume `char` when it is next. */
  private take(char: string): boolean {
    this.skipSpace();
    if (this.text[this.at] !== char) {
      return false;
    }
    this.at += 1;
    return true;
  }

  private expect(char: string): void {
    if (!this.take(char)) {
      throw new NotWkt();
    }
  }

  /** A word, upper case, or null without consuming anything. */
  private peekWord(): string | null {
    const at = this.at;
    const word = this.match(WORD);
    this.at = at;
    return word?.toUpperCase() ?? null;
  }

  end(): void {
    this.skipSpace();
    if (this.at !== this.text.length) {
      throw new NotWkt();
    }
  }

  /** `( item , item … )` */
  private list<T>(item: () => T): T[] {
    this.expect("(");
    const items = [item()];
    while (this.take(",")) {
      items.push(item());
    }
    this.expect(")");
    return items;
  }

  /** 2 to 4 numbers: x y, then z and m as `dims` says. */
  private position(dims: Dimensions): Position {
    const values: number[] = [];
    for (let n = this.match(NUMBER); n !== null; n = this.match(NUMBER)) {
      const value = Number(n);
      if (!Number.isFinite(value)) {
        throw new NotWkt();
      }
      values.push(value);
    }
    const expected = dims === "ZM" ? 4 : dims === "" ? -1 : 3;
    if (
      values.length < 2 ||
      values.length > 4 ||
      (expected !== -1 && values.length !== expected) ||
      (dims === "" && values.length > 3)
    ) {
      throw new NotWkt();
    }
    return dims === "M" ? values.slice(0, 2) : values.slice(0, 3);
  }

  private line(dims: Dimensions): Position[] {
    const positions = this.list(() => this.position(dims));
    if (positions.length < 2) {
      throw new NotWkt();
    }
    return positions;
  }

  /** A closed ring of at least four positions. */
  private ring(dims: Dimensions): Position[] {
    const positions = this.line(dims);
    const first = positions[0];
    const last = positions[positions.length - 1];
    if (
      positions.length < 4 ||
      first.length !== last.length ||
      first.some((v, i) => v !== last[i])
    ) {
      throw new NotWkt();
    }
    return positions;
  }

  private polygon(dims: Dimensions): Position[][] {
    return this.list(() => this.ring(dims));
  }

  /** A MULTIPOINT member: `(x y)`, or `x y` as many programs write it. */
  private multiPointMember(dims: Dimensions): Position {
    if (!this.take("(")) {
      return this.position(dims);
    }
    const p = this.position(dims);
    this.expect(")");
    return p;
  }

  /** One tagged geometry. `top` allows EMPTY, which gives null. */
  geometry(depth: number, top: boolean): Geometry | null {
    if (depth > MAX_DEPTH) {
      throw new NotWkt();
    }
    const tag = this.match(WORD)?.toUpperCase();
    let dims: Dimensions = "";
    const next = this.peekWord();
    if (next === "Z" || next === "M" || next === "ZM") {
      this.match(WORD);
      dims = next;
    }
    if (this.peekWord() === "EMPTY") {
      if (!top) {
        throw new NotWkt();
      }
      this.match(WORD);
      return null;
    }
    switch (tag) {
      case "POINT": {
        this.expect("(");
        const coordinates = this.position(dims);
        this.expect(")");
        return { type: "Point", coordinates };
      }
      case "LINESTRING":
        return { type: "LineString", coordinates: this.line(dims) };
      case "POLYGON":
        return { type: "Polygon", coordinates: this.polygon(dims) };
      case "MULTIPOINT":
        return {
          type: "MultiPoint",
          coordinates: this.list(() => this.multiPointMember(dims)),
        };
      case "MULTILINESTRING":
        return {
          type: "MultiLineString",
          coordinates: this.list(() => this.line(dims)),
        };
      case "MULTIPOLYGON":
        return {
          type: "MultiPolygon",
          coordinates: this.list(() => this.polygon(dims)),
        };
      case "GEOMETRYCOLLECTION":
        return {
          type: "GeometryCollection",
          geometries: this.list(() => this.geometry(depth + 1, false)!),
        };
      default:
        throw new NotWkt();
    }
  }
}

/**
 * The geometry in a Well-Known Text, or null when the text is not exactly
 * one geometry: a syntax error, an unknown type, a number out of range, a
 * line of fewer than two positions, a ring that is not closed or has fewer
 * than four, or EMPTY.
 */
export function parseWKT(text: string): Geometry | null {
  const reader = new Reader(text.replace(SRID, ""));
  try {
    const geometry = reader.geometry(0, true);
    reader.end();
    return geometry;
  } catch (err) {
    if (err instanceof NotWkt) {
      return null;
    }
    throw err;
  }
}
