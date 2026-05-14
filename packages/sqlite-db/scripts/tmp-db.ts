import Database from 'better-sqlite3';
import { mkdirSync, readdirSync, readFileSync, unlinkSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(__dirname, '..');
const migrationsDir = join(packageRoot, 'migrations');
const tmpDbPath = join(packageRoot, 'tmp', '.tmp.db');

mkdirSync(dirname(tmpDbPath), { recursive: true });

// Remove stale file if it exists
try {
  unlinkSync(tmpDbPath);
} catch {
  /* may not exist */
}

const db = new Database(tmpDbPath);
const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort();
for (const file of files) {
  db.exec(readFileSync(join(migrationsDir, file), 'utf-8'));
}
db.close();

console.log(`Created ${tmpDbPath} with ${files.length} migrations`);
