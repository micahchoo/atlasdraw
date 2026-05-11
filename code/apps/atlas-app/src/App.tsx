import { MapEditor } from "./components/MapEditor";

// India default viewport — matches both the maintainer's interest area and
// the world-low-zoom.pmtiles archive (zoom 0-6 global coverage). Per-user
// override belongs in a user-settings store (deferred to Phase 5+).
const INITIAL_VIEW = {
  center: [78.5, 22] as [number, number],
  zoom: 4,
};

export function App() {
  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <MapEditor initialView={INITIAL_VIEW} />
    </div>
  );
}
