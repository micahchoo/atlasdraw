// SPDX-License-Identifier: AGPL-3.0-only
//
// Where MapLibre starts its worker. Import this module for its effect, once,
// before the first map is made (hooks/useBasemapStyle.ts does).
//
// MapLibre 6 is ESM only and finds its worker at run time as
// `./maplibre-gl-worker.mjs` beside its own module. A bundle moves that
// module into assets/ under another name, so the worker 404s and the map
// paints no tiles, with only "Worker failed to load" in the console.
// `?worker&url` makes Vite bundle the worker as its own entry (with the
// shared code it imports) and gives its real URL.

import { setWorkerUrl } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

setWorkerUrl(workerUrl);
