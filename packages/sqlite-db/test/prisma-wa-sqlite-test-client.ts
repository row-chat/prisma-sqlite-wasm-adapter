import {
  createWaSqliteRemote,
  WaSqliteAdapterFactory,
  type WaSqliteAPI,
} from '@row-chat/prisma-wa-sqlite-adapter';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Factory } from 'wa-sqlite';
import SQLiteAsyncModuleFactory from 'wa-sqlite/dist/wa-sqlite-async.mjs';
import { PrismaClient } from '../prisma/generated/client/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, '../migrations');
const migrationSql = readdirSync(migrationsDir)
  .filter((f: string) => f.endsWith('.sql'))
  .sort()
  .map((f: string) => readFileSync(join(migrationsDir, f), 'utf-8'));

// wa-sqlite's Factory return type isn't published in a form we can import,
// so we cast through a local shape extending the adapter's structural type
// with the `open_v2` call we need for setup.
type WaSqliteAPIWithOpen = WaSqliteAPI & {
  open_v2(path: string): Promise<number>;
};

// Path resolution at module-load time so the test runner's cwd doesn't
// matter. Node's `fetch()` can't read `file:` URLs (undici limitation), so
// Emscripten's default wasm loader fails — we bypass it by handing the
// pre-read bytes to Module via `wasmBinary`.
const wasmBinary = readFileSync(
  fileURLToPath(import.meta.resolve('wa-sqlite/dist/wa-sqlite-async.wasm')),
);

export async function createTestClient() {
  const wasmModule = await SQLiteAsyncModuleFactory({ wasmBinary });
  const sqlite3 = Factory(wasmModule) as unknown as WaSqliteAPIWithOpen;
  // wa-sqlite's built-in memory VFS handles `:memory:`; no VFS registration.
  const db = await sqlite3.open_v2(':memory:');
  await sqlite3.exec(db, 'PRAGMA foreign_keys = ON;');
  for (const sql of migrationSql) await sqlite3.exec(db, sql);
  const remote = createWaSqliteRemote(sqlite3, db);
  const adapter = new WaSqliteAdapterFactory(remote);
  return new PrismaClient({ adapter });
}
