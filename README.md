# Prisma browser adapters

Two [Prisma](https://www.prisma.io/) driver adapters for running Prisma and SQLite entirely in the browser, plus a sample app that exercises both.

| Package                                                                       | Backed by                                                                                                           | When to choose it                                                                                                                                                                      |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@row-chat/prisma-sqlite-wasm-adapter`](packages/prisma-sqlite-wasm-adapter) | [`@sqlite.org/sqlite-wasm`](https://www.npmjs.com/package/@sqlite.org/sqlite-wasm) — the official SQLite WASM build | Default choice. OPFS API is synchronous and must live in a Worker, which is straightforward to set up with a SharedWorker.                                                             |
| [`@row-chat/prisma-wa-sqlite-adapter`](packages/prisma-wa-sqlite-adapter)     | [`wa-sqlite`](https://github.com/rhashimoto/wa-sqlite) — community SQLite WASM build with Asyncify                  | Pick this if you need wa-sqlite's async VFS surface — e.g. `OPFSCoopSyncVFS` for sharing a database across tabs without a SharedWorker, or running SQLite directly on the main thread. |

Both adapters share the same shape: hand the adapter a "remote" object exposing the database (typically via [Comlink](https://www.npmjs.com/package/comlink)), and pass the result to `PrismaClient`. The remote interface is what decouples the adapter from your worker topology — SharedWorker, dedicated Worker, or no worker at all are all supported.

## Demo

A live example is deployed at [row-chat.github.io/prisma-browser-adapters](https://row-chat.github.io/prisma-browser-adapters/), with source under [`apps/web`](apps/web). It loads the [Chinook](https://github.com/lerocha/chinook-database) sample database in the browser and exposes it through a Prisma Client REPL, a raw SQL REPL, and an embedded [Prisma Studio](https://www.prisma.io/studio).

## Repository layout

- [`packages/prisma-sqlite-wasm-adapter`](packages/prisma-sqlite-wasm-adapter) — adapter for `@sqlite.org/sqlite-wasm`
- [`packages/prisma-wa-sqlite-adapter`](packages/prisma-wa-sqlite-adapter) — adapter for `wa-sqlite`
- [`packages/sqlite-db`](packages/sqlite-db) — Prisma schema, migrations, and integration tests for the SQLite-based adapters
- [`apps/web`](apps/web) — the demo app

## Development

```sh
npm install
npm run typecheck
npm run lint
npm test       # runs both adapter test suites against the Chinook schema
npm run dev    # boots the demo app
```

## License

Apache-2.0
