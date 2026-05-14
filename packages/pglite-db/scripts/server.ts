import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import db from './pglite';

const server = new PGLiteSocketServer({ db });
await server.start();

console.log('PGlite server started');

const shutdown = async () => {
  await server.stop();
  await db.close();
  console.log('PGlite dev server stopped');
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
