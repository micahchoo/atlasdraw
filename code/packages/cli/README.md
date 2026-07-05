# @atlasdraw/cli

Headless tooling for `.atlasdraw` files. Two commands today: `lint` and
`convert`. (`render` was planned as T12 and is **not implemented** — the
entry point registers only the two commands.)

Workspace-internal package (not published). Binary name: `atlasdraw`.

## Usage

The `bin` entry points at TypeScript source and there is no build step yet
(the `build` script is a TODO), so invoke it with a TS-capable runner from
the `code/` directory:

```bash
yarn dlx tsx packages/cli/src/atlasdraw.ts lint <file.atlasdraw>
yarn dlx tsx packages/cli/src/atlasdraw.ts convert <in> <out>
```

Run either command with `--help` for its options. The commands are also
exercised directly by the vitest suite.

## Development

```bash
yarn workspace @atlasdraw/cli test         # vitest
yarn test:typecheck
```

Architecture notes: [`docs/architecture/subsystems/cli/`](../../../docs/architecture/subsystems/cli/).

## License

MIT (see [/code/LICENSING.md](../../LICENSING.md) for the per-package breakdown).
