import {
  createSqliteWasmRemote,
  SqliteWasmAdapterFactory,
  type Sqlite3DB,
} from '@row-chat/prisma-sqlite-wasm-adapter';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '../prisma/generated/client/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, '../migrations');
const migrationSql = readdirSync(migrationsDir)
  .filter((f: string) => f.endsWith('.sql'))
  .sort()
  .map((f: string) => readFileSync(join(migrationsDir, f), 'utf-8'));

export async function createTestClient() {
  const sqlite3 = await sqlite3InitModule();
  const db = new sqlite3.oo1.DB(':memory:', 'c');
  db.exec('PRAGMA foreign_keys = ON;');
  const remote = createSqliteWasmRemote(db as unknown as Sqlite3DB, sqlite3);
  for (const sql of migrationSql) db.exec(sql);
  const adapter = new SqliteWasmAdapterFactory(remote);
  return new PrismaClient({ adapter });
}
