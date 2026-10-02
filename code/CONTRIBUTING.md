# Contributing

## Set up

Use Node 22 (`../.nvmrc`). From this folder:

```bash
corepack enable
yarn install
yarn start            # the editor on http://localhost:5174
```

## Before you open a pull request

CI runs these, from this folder. Run them first:

```bash
yarn test:typecheck
yarn test:code        # ESLint, no warnings allowed
yarn test:other       # Prettier
yarn test:falsifiable # every test can fail
yarn test --watch=false
```

If you changed the editor's behaviour in the browser, also run `yarn workspace @atlasdraw/atlas-app e2e`.

## Where things go

- Editor features: `apps/atlas-app/`. Server changes: `apps/storage/` or `apps/realtime/`.
- The Excalidraw fork (`packages/{excalidraw,element,math,common,utils}`) is Atlasdraw's own code. Change it where the change belongs; do not add CSS overrides on top of it.
- A change to a decision needs an ADR. Product ADRs go in `../docs/architecture/adr/`, with the next free number.

For a large feature, open an issue to discuss it before you write code.
