# @atlasdraw/protocol

Atlasdraw wire-protocol types shared by the client and the realtime relay:
the `CollabEvent` union for Socket.IO scene/cursor traffic, the `RoomKey`
URL-fragment parser (`#room:<roomId>,<base64url-key>`, per Q-P5-2), and the
versioned comment-thread schema carried in the per-room comments `Y.Doc`.

Workspace-internal package (not published). Consumed by `apps/atlas-app` and
`apps/realtime`.

## Usage

```ts
import type { CollabEvent, RoomKey, CommentSchemaV1 } from "@atlasdraw/protocol";
```

## Development

```bash
yarn workspace @atlasdraw/protocol test    # vitest
yarn test:typecheck
```

## License

MIT (see [/code/LICENSING.md](../../LICENSING.md) for the per-package breakdown).
