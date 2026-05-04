import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// stripped PWA in Phase 0
// import { registerSW } from "virtual:pwa-register";

// stripped: Sentry init (ADR 0006) — import removed in Phase 0 Task 9b
// import "../excalidraw-app/sentry";

import ExcalidrawApp from "./App";

window.__EXCALIDRAW_SHA__ = import.meta.env.VITE_APP_GIT_SHA;
const rootElement = document.getElementById("root")!;
const root = createRoot(rootElement);
// stripped PWA in Phase 0 — registerSW() removed
// registerSW();
root.render(
  <StrictMode>
    <ExcalidrawApp />
  </StrictMode>,
);
