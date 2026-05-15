import { PGliteWorker } from '@electric-sql/pglite/worker';

export type ConnectPgliteSharedWorkerOptions = {
  /**
   * Identifier the worker returned during its handshake. Must match the
   * `workerId` passed to `startPgliteSharedWorker` (default `'pglite'`).
   */
  id?: string;
  /**
   * Optional `name` passed through to the `SharedWorker` constructor.
   */
  name?: string;
};

/**
 * Attaches to a PGlite SharedWorker started with `startPgliteSharedWorker`
 * and returns a `PGliteWorker` ready to feed into Prisma's pglite adapter.
 *
 * Typical use:
 *
 * ```ts
 * import { PGlite } from '@electric-sql/pglite';
 * import { connectPgliteSharedWorker } from '@row-chat/prisma-pglite-adapter';
 * import { PrismaPGlite } from 'pglite-prisma-adapter';
 * import PgliteSharedWorker from './pglite-shared-worker.ts?sharedworker';
 *
 * const pglite = connectPgliteSharedWorker(PgliteSharedWorker);
 * const adapter = new PrismaPGlite(pglite as unknown as PGlite);
 * const prisma = new PrismaClient({ adapter });
 * ```
 *
 * The `pglite as unknown as PGlite` cast is needed because `PrismaPGlite`'s
 * constructor accepts the concrete `PGlite` class while `PGliteWorker` only
 * implements `PGliteInterface`. They're functionally interchangeable here.
 */
export function connectPgliteSharedWorker(
  SharedWorkerCtor: new (options?: WorkerOptions) => SharedWorker,
  options: ConnectPgliteSharedWorkerOptions = {},
): PGliteWorker {
  const id = options.id ?? 'pglite';
  const sw = new SharedWorkerCtor(options.name ? { name: options.name } : {});
  sw.port.start();
  // PGliteWorker expects a `Worker` shape; the SharedWorker's port satisfies
  // the message-passing surface but not the nominal type, so we adapt.
  const workerAdapter = {
    postMessage: sw.port.postMessage.bind(sw.port),
    addEventListener: sw.port.addEventListener.bind(sw.port),
    removeEventListener: sw.port.removeEventListener.bind(sw.port),
    terminate: () => sw.port.close(),
  } as unknown as Worker;
  return new PGliteWorker(workerAdapter, { id });
}
