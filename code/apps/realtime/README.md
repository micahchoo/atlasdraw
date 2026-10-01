# @atlasdraw/realtime

The Atlasdraw relay. It holds one Y.Doc per room and syncs it to every connection over the y-websocket protocol (`/yjs/<roomId>`). The relay reads everything in a room; the room link's key, not the room id, is what lets a client in (ADR-0014). Rooms are saved to a SQLite file (ADR-0018).

**License:** AGPL-3.0-only.

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `4001` | HTTP port: `GET /health` and the WebSocket upgrade on `/yjs/` |
| `ROOMS_DB` | `./data/rooms.sqlite` | The SQLite file rooms are saved to |
| `MAX_ROOMS` | `1000` | Rooms held in memory at one time |
| `MAX_ROOM_SIZE` | `50` | Connections to one room |
| `MAX_MESSAGE_BYTES` | `16777216` | The largest message a client may send. A larger one closes that socket with 1009; the relay stays up |
| `MAX_ROOM_BYTES` | `67108864` | The largest room. An update that would pass it is refused before it is applied (4413, "room too large: N > cap") |
| `MAX_TOTAL_ROOM_BYTES` | `2147483648` | All stored rooms together. A new room or a growing save past it is closed with 4507. `0`: no cap |
| `MAX_NEW_ROOMS_PER_IP` | `30` | New rooms one client address may make in an hour (4429). `0`: no limit |
| `MAX_CONNECTIONS_PER_IP` | `64` | Open connections from one client address (4429). `0`: no limit |
| `ROOM_EXPIRY_DAYS` | `90` | Delete a room nobody was in for this many days. `0`: never |
| `ROOM_SWEEP_INTERVAL_MS` | `3600000` | How often the expiry sweep runs. It also runs at start |
| `TRUST_PROXY` | `false` | Read the client address from `X-Forwarded-For`: `true`, `false` or the number of proxies in front. Set `1` behind one reverse proxy |

The two size defaults come from `@atlasdraw/protocol` `ROOM_SIZE`, which the editor also reads: it seeds a room in messages under the cap and refuses a map over it. Set either lower and the editor lets users make what this relay refuses (the relay warns at start). `yarn build` bundles the protocol into `dist/index.js` (`build.mjs`).

Run it with `yarn workspace @atlasdraw/realtime dev`; test it with `npx vitest run apps/realtime` from `code/`.
