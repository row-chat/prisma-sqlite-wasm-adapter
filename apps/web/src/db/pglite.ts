import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';

const migrations = import.meta.glob('../../db/migrations/client/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export async function createPglite() {
  const pglite = await PGlite.create({
    extensions: { pgcrypto, uuid_ossp },
  });

  for (const path of Object.keys(migrations).sort()) {
    await pglite.exec(migrations[path]);
  }

  return pglite;
}
