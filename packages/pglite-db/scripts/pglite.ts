import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import fs from 'node:fs';

const migrationDir = `${import.meta.dirname}/../migrations`;

// Strip preamble lines that the canonical Chinook PostgreSQL script ships
// with: DROP/CREATE DATABASE manage the database lifecycle (pglite is
// already a single in-memory db) and `\c` is a psql meta-command that the
// wire protocol can't parse.
function stripPgliteIncompatibleStatements(sql: string): string {
  return sql
    .split('\n')
    .filter((line) => !/^\s*(DROP DATABASE|CREATE DATABASE|\\c\b)/i.test(line))
    .join('\n');
}

export async function createPglite() {
  const pglite = await PGlite.create({
    extensions: { pgcrypto, uuid_ossp },
  });

  const files = fs
    .readdirSync(migrationDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sql = fs.readFileSync(`${migrationDir}/${file}`).toString();
    await pglite.exec(stripPgliteIncompatibleStatements(sql));
  }

  return pglite;
}
