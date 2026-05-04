// @atlasdraw/realtime — Phase 0 stub.
// Real relay lands Phase 5:
//   - /socket.io endpoint: SCENE_UPDATE (Excalidraw LWW), MAP_CAMERA_UPDATE, CURSOR, COMMENT
//   - /yjs/:roomId endpoint: y-websocket for DATA_LAYER_OP (separate connection per Q9)
//   - Optional Redis adapter (@socket.io/redis-adapter) keyed atlasdraw:sio
//   - TTL eviction (5min default)
//   - E-01 BLOCKED on encryption boundary; ships server-trusted Phase 5, wires Phase 6
// See docs/architecture/subsystems/realtime/

console.error('atlasdraw/realtime: Phase 0 stub. See docs/superpowers/plans/2026-05-03-atlasdraw-phase-5-realtime.md');
process.exit(2);
