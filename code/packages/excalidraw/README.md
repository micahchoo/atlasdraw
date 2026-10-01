# @atlasdraw/excalidraw

Part of Atlasdraw's fork of [Excalidraw](https://github.com/excalidraw/excalidraw). The editor component (`<Excalidraw>`), its UI, actions, rendering and export. Atlasdraw adds props for the map: `screenSizedStyles`, `onZoomAction` and `onSidebarLayoutChange` among them (see `interface ExcalidrawProps` in `types.ts`).

This package is `private: true` and is not published; `npm install` cannot get it. Use it from inside the `code/` workspace:

```ts
import /* … */ "@atlasdraw/excalidraw";
```

Atlasdraw owns the fork outright (`code/decisions/0010-own-the-fork.md`). Nothing syncs from upstream; the fork point and how to port a security fix are in `VENDOR.md` at the repository root.

The other packages read this one's built types, so run `yarn build:types` (or `yarn test:typecheck`, which runs it) from `code/` after a change.

## License

MIT, as upstream (`code/LICENSE-EXCALIDRAW-UPSTREAM`).
