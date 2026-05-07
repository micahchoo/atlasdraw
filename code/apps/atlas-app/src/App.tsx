import { MapEditor } from "./components/MapEditor";

// San Francisco default viewport
const INITIAL_VIEW = {
  center: [-122.4194, 37.7749] as [number, number],
  zoom: 12,
};

export function App() {
  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <MapEditor initialView={INITIAL_VIEW} />
    </div>
  );
}
