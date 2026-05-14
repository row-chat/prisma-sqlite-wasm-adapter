import {
  SqliteWasmAdapterFactory,
  type SqliteWasmRemote,
} from '@row-chat/prisma-sqlite-wasm-adapter';
import { PrismaClient } from '@row-chat/sqlite-db/edge';
import { wrap } from 'comlink';

const worker = new SharedWorker(
  new URL('./sqlite-worker.ts', import.meta.url),
  {
    type: 'module',
  },
);

worker.port.onmessageerror = (e) => {
  console.error('[sqlite-worker] message error', e);
};

worker.onerror = (e) => {
  console.error('[sqlite-worker] failed to load', e);
};

const remote = wrap<SqliteWasmRemote>(worker.port);
export { remote as workerApi };
const adapter = new SqliteWasmAdapterFactory(remote);

const prisma = new PrismaClient({ adapter });
export default prisma;
