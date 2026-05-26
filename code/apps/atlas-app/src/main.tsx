import React from "react";
import { createRoot } from "react-dom/client";

import "maplibre-gl/dist/maplibre-gl.css";

import "./styles/tokens.css";
import "./styles/excalidraw-theme.css";

// Phase 6 A14b — high-contrast theme overrides. Activates under
// prefers-contrast:more or [data-theme="high-contrast"] on <html>.
import "./styles/high-contrast.css";

import { App } from "./App";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Missing #root element");
}

createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
