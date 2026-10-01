# @atlasdraw/protocol

The room-link and comment formats of Atlasdraw's live rooms. The package depends on nothing.

Workspace-internal package (not published). Consumed by `apps/atlas-app` and by the relay, `apps/realtime`, which bundles it into its build.

## Capabilities

- **Room links** (`room-link.ts`). A room link is `#room:<roomId>,<secret>`: the room id is a UUID, and the secret is 32 random bytes in base64url. The fragment never reaches a server. `newRoomLink` makes one; `parseRoomLink` and `roomFragment` read and write it. `roomToken` derives the token that admits a client (HKDF-SHA256, salt the room id, info `atlasdraw-room-auth`); `roomTokenMessage` / `readRoomTokenMessage` frame it as the first WebSocket message (ADR-0014).
- **Wire facts** (`wire.ts`). `ROOM_SIZE`, the one size table: the message cap (16 MiB), the room cap (64 MiB) and the record caps (a raster, a data layer's features, a drawing image), each under the message cap so a record the editor allows fits in one message. `CLOSE`, the close codes the relay sends and the editor reads (4403 denied, 4409 full, 4413 room too large, 4429 limited, 4507 no space, 1009 message too large). `closeReason` / `readCloseReason` for "what: size > cap", `isRoomId`, `sizeText`.
- **Comments** (`comment-schema.ts`). `CommentSchemaV1`, its anchor (a place or an element id) and `normalizeAnchor`, for the comments array in a room's Y.Doc (`COMMENTS_ARRAY_KEY`).

## Usage

```ts
import { newRoomLink, parseRoomLink, roomToken } from "@atlasdraw/protocol";
import type { RoomLink, CommentSchemaV1 } from "@atlasdraw/protocol";
```

## Development

```bash
npx vitest run packages/protocol   # from code/
yarn --cwd packages/protocol test:typecheck
```

## License

MIT (see [/code/LICENSING.md](../../LICENSING.md) for the per-package breakdown).
