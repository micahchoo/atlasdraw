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

      {/* Demo overlay */}
      <div
        style={{
          position: "absolute",
          top: 12,
          left: "50%",
          transform: "translateX(-50%)",
          background: "rgba(0,0,0,0.65)",
          color: "#fff",
          padding: "6px 14px",
          borderRadius: 6,
          fontSize: 13,
          fontFamily: "system-ui, sans-serif",
          pointerEvents: "none",
          whiteSpace: "nowrap",
          zIndex: 10,
        }}
      >
        Atlasdraw Phase 1 Wave 3 Demo — MapEditor (sync hook lands in Task 12, pointer-gate in Task 13)
      </div>
    </div>
  );
}
