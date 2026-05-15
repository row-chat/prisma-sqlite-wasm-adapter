# @row-chat/prisma-pglite-adapter

A SharedWorker helper for running [`pglite-prisma-adapter`](https://github.com/lucasthevenet/pglite-utils/tree/main/packages/pglite-prisma-adapter) in the browser. Hosts one PGlite instance per origin so every browser tab sees the same database without leader-election churn.

This package isn't a Prisma adapter on its own — `pglite-prisma-adapter` is the actual adapter. What this package adds is the SharedWorker wiring that lets multiple tabs share a single PGlite instance.

## Install

```sh
npm install @row-chat/prisma-pglite-adapter @electric-sql/pglite pglite-prisma-adapter
```

## Demo

The [`prisma-browser-adapters` demo](https://row-chat.github.io/prisma-browser-adapters/) loads Chinook in the browser and exposes it through a Prisma Client REPL, a SQL REPL, and an embedded Prisma Studio — all client-side.

## When to use this over `PGliteWorker` alone

`@electric-sql/pglite/worker` already supports multi-tab access out of the box. Each tab creates its own dedicated `Worker`; the workers race for a Web Lock (`pglite-election-lock:<id>`); whichever wins hosts PGlite and the others proxy queries to it over BroadcastChannel. When the leader tab closes, another worker grabs the lock and takes over.

That model works, but has a few rough edges:

- **Leader churn.** Closing the leader tab triggers a hand-off. Queries in flight at that moment receive a `LeaderChangedError`.
- **Memory.** Every tab spins up its own Worker with a copy of the PGlite WASM runtime, even if it's only acting as a proxy.
- **`LISTEN`/`NOTIFY` plumbing.** Subscriptions are tied to whichever worker is the current leader.

The SharedWorker pattern this package wraps trades those for different trade-offs:

- One PGlite instance per origin. No leader, no hand-offs, no `LeaderChangedError`.
- One WASM runtime. Other tabs hold only a thin RPC client.
- The SharedWorker dies only when the browser kills it under memory pressure — there's no automatic failover if that happens.

Pick this if you prefer stable connection semantics over implicit fail-over. Pick stock `PGliteWorker` if you'd rather have automatic recovery when any single tab crashes.

## Recipe: PGlite + Prisma in the browser, without this package

Setup isn't obvious if you piece it together from scratch. The minimum viable stack with stock `PGliteWorker`:

### 1. Generate a Prisma client pointed at your PGlite schema

In your Prisma schema (any package):

```prisma
generator client {
  provider = "prisma-client-js"
  output   = "./generated/client"
}

datasource db {
  provider = "postgresql"
}
```

`prisma db pull` against a running PGlite (see [`packages/pglite-db`](../pglite-db) in this repo for one approach: a `pglite-socket` server + `prisma db pull` over `127.0.0.1:5432` with `?sslmode=disable`).

### 2. Worker entry (`pglite-worker.ts`)

```ts
import { PGlite } from '@electric-sql/pglite';
import { worker } from '@electric-sql/pglite/worker';

worker({
  async init() {
    const db = await PGlite.create();
    // Apply migrations here, or load a serialized dump:
    // await db.exec(MIGRATIONS_SQL);
    return db;
  },
});
```

### 3. Main thread (`prisma-pglite-client.ts`)

```ts
import type { PGlite } from '@electric-sql/pglite';
import { PGliteWorker } from '@electric-sql/pglite/worker';
import { PrismaClient } from './prisma/generated/client/edge';
import { PrismaPGlite } from 'pglite-prisma-adapter';

const pglite = new PGliteWorker(
  new Worker(new URL('./pglite-worker.ts', import.meta.url), {
    type: 'module',
  }),
);

// `PrismaPGlite`'s constructor accepts the concrete `PGlite` class while
// `PGliteWorker` only implements `PGliteInterface`. They're functionally
// interchangeable here.
const adapter = new PrismaPGlite(pglite as unknown as PGlite);
export const prisma = new PrismaClient({ adapter });
```

That gives you a working Prisma-over-PGlite stack with leader-election-based multi-tab sharing. No `@row-chat/prisma-pglite-adapter` needed.

### Two non-obvious bits

- **`pglite-prisma-adapter` ships its own nested copy of `@prisma/driver-adapter-utils`**. If you're on Prisma 7 and the nested version is on 6, you'll get type errors at the `PrismaClient({ adapter })` boundary. Fix at the workspace root with an `overrides` block:

  ```json
  "overrides": {
    "@prisma/driver-adapter-utils": "^7.8.0"
  }
  ```

- **The `pglite as unknown as PGlite` cast** is required because `PGliteWorker` declares `implements PGliteInterface`, not `extends PGlite`. The structural shape is the same; only the nominal types differ.

## Usage with this package (SharedWorker variant)

### 1. SharedWorker entry

```ts
// pglite-shared-worker.ts
import { PGlite } from '@electric-sql/pglite';
import { startPgliteSharedWorker } from '@row-chat/prisma-pglite-adapter/shared-worker';

startPgliteSharedWorker({
  async createPglite() {
    const db = await PGlite.create();
    // Apply migrations here.
    return db;
  },
});
```

### 2. Main thread

```ts
import type { PGlite } from '@electric-sql/pglite';
import { connectPgliteSharedWorker } from '@row-chat/prisma-pglite-adapter';
import { PrismaClient } from './prisma/generated/client/edge';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import PgliteSharedWorker from './pglite-shared-worker.ts?sharedworker';

const pglite = connectPgliteSharedWorker(PgliteSharedWorker);
const adapter = new PrismaPGlite(pglite as unknown as PGlite);
export const prisma = new PrismaClient({ adapter });
```

The `?sharedworker` query suffix is a Vite convention — see [`vite/client.d.ts`](https://github.com/vitejs/vite/blob/main/packages/vite/client.d.ts) for the ambient module declarations. Other bundlers have their own equivalent (e.g. webpack 5's `new SharedWorker(new URL(…))` syntax).

## API

### `connectPgliteSharedWorker(SharedWorkerCtor, options?)`

Main-thread helper. Constructs the `SharedWorker`, adapts its port to look like a `Worker`, and returns a `PGliteWorker` ready to pass to `PrismaPGlite`.

```ts
type ConnectPgliteSharedWorkerOptions = {
  /** Must match the `workerId` passed to `startPgliteSharedWorker`. Default `'pglite'`. */
  id?: string;
  /** Forwarded to the `SharedWorker` constructor. */
  name?: string;
};
```

### `startPgliteSharedWorker(options)` (from `./shared-worker`)

Worker-thread entry. Wires up the handshake, per-tab RPC, and tab-close cleanup that `PGliteWorker` expects.

```ts
type StartPgliteSharedWorkerOptions = {
  /** Returns a ready PGlite. Called once when the first tab connects; the same instance is reused for every subsequent tab. */
  createPglite: () => Promise<PGliteInterface>;
  /** Identifier returned during the handshake; clients pass the same value as `id`. Default `'pglite'`. */
  workerId?: string;
};
```

## Migrations

`prisma migrate` is a Node CLI and can't reach a database living in a browser. Use it during development against a local PGlite server (the [`packages/pglite-db`](../pglite-db) approach in this repo: start `pglite-socket-server` and run `prisma db pull` over a postgres-protocol URL with `?sslmode=disable`). Bundle the resulting `.sql` migrations with the app and apply them in `createPglite()`.

## Notes

- The shared worker runs a 500 ms keep-alive `setInterval` so Chrome doesn't terminate it as soon as the last tab port closes. Other browsers are more lenient about SharedWorker lifecycle.
- On tab close, the worker explicitly `ROLLBACK`s an in-progress transaction owned by that tab so the shared connection isn't stranded mid-transaction.
- `connectPgliteSharedWorker` returns a `PGliteWorker` (from `@electric-sql/pglite/worker`), so anything that accepts a `PGliteInterface` works — not just the Prisma adapter. Raw `db.query`, `LISTEN`/`NOTIFY`, dump/restore all work normally.

## License

Apache-2.0
