import type { Sqlite3DB } from '@row-chat/prisma-sqlite-wasm-adapter';
import { createSqliteWasmRemote } from '@row-chat/prisma-sqlite-wasm-adapter';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { expose } from 'comlink';

const migrationUrls = import.meta.glob(
  '../../../../packages/sqlite-db/migrations/*.sql',
  { query: '?url', eager: true },
) as Record<string, { default: string }>;

const DB_FILENAME = 'row-chat.db';

const dbReady = (async () => {
  const sqlite3 = await sqlite3InitModule();
  const poolVfs = await sqlite3.installOpfsSAHPoolVfs({});
  const db = new poolVfs.OpfsSAHPoolDb(DB_FILENAME);
  db.exec('PRAGMA foreign_keys = ON;');
  const api = createSqliteWasmRemote(db as unknown as Sqlite3DB, sqlite3);

  const stmt = db.prepare('PRAGMA user_version');
  stmt.step();
  const appliedVersion = (stmt.get([])[0] as number) ?? 0;
  stmt.finalize();

  for (const key of Object.keys(migrationUrls).sort()) {
    const match = key.match(/(\d+)-[^/]+\.sql$/);
    if (!match) continue;
    const version = Number(match[1]);
    if (version <= appliedVersion) continue;
    const sql = await fetch(migrationUrls[key].default).then((r) => r.text());
    db.exec(sql);
    db.exec(`PRAGMA user_version = ${version}`);
  }

  return api;
})();

addEventListener('connect', async (e) => {
  const port = (e as MessageEvent).ports[0];
  expose(await dbReady, port);
});
