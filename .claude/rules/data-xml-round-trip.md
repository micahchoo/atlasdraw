---
paths:
  - code/packages/data/src/export.ts
  - code/packages/data/src/geoxml.ts
  - code/packages/data/src/wkt.ts
  - code/packages/data/src/csv.ts
tags: [import, export, kml, gpx, wkt]
priority: normal
source: hand-written
---

# Every writer is tested against the app's own reader

`export.ts` writes GeoJSON, CSV, KML and GPX. Each writer has a round-trip
test through `parse`, `parseCSV`, `parseKML` or `parseGPX`. A change to a
writer or a reader keeps that test green.

- **KML types travel in a Schema.** `toKML` declares each ExtendedData key
  as `double`, `bool` or `string`. `@tmcw/togeojson` reads a `bool` with
  `Boolean(text)`, so "false" read as true. `geoxml.ts#readBoolFieldsAsKml`
  empties a false value first. Do not remove it when togeojson is upgraded
  until a test shows the defect is gone.
- **XML text escapes all five markup characters** and drops the characters
  XML 1.0 cannot hold. No CDATA: `]]>` in a value would end it.
- **GPX holds what GPX holds**: `name`, `cmt`, `desc`, `type`, `sym`,
  `time`, elevation, track-point times. Other properties are not written,
  and areas are not offered (`dataLayerExport.ts#exportChoices`). A layer
  read from GPX writes back the same.
- **A WKT cell that does not parse is dropped and counted**, never fatal.
  `wkt.ts` caps GEOMETRYCOLLECTION nesting at 32, because one cell of a
  50 MB file can nest deeper than the call stack.

Verify with `cd code && npx vitest run packages/data`.
