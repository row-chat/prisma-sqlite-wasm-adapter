import type { PGliteInterface } from '@electric-sql/pglite';

// Private PGlite methods not in the public type but required by PGliteWorker's
// wire protocol. The names match @electric-sql/pglite's internal contract.
interface PGlitePrivate {
  execProtocolRawStream(data: Uint8Array, ...rest: unknown[]): Promise<void>;
  syncToFs?(): Promise<void>;
  _handleBlob(blob?: File | Blob): Promise<void>;
  _getWrittenBlob(): Promise<File | Blob>;
  _cleanupBlob(): Promise<void>;
  _checkReady(): Promise<void>;
  _runExclusiveQuery(fn: () => Promise<void>): void;
  _runExclusiveTransaction(fn: () => Promise<void>): void;
}

export type StartPgliteSharedWorkerOptions = {
  /**
   * Factory that returns a ready PGlite instance. Called once when the first
   * tab connects. The same PGlite is reused across every tab attached to
   * this SharedWorker.
   */
  createPglite: () => Promise<PGliteInterface>;
  /**
   * Identifier returned to the client during the handshake; clients pass
   * the same id to `PGliteWorker({ id })`. Defaults to `'pglite'`. Use a
   * distinct id per logical database if you run more than one SharedWorker.
   */
  workerId?: string;
};

/**
 * Entry point for a PGlite SharedWorker. Call this from a `?sharedworker`
 * module; it wires up the handshake, per-tab RPC channel, and tab-close
 * cleanup that `@electric-sql/pglite/worker`'s `PGliteWorker` client expects.
 *
 * Typical use from a consumer's shared worker file:
 *
 * ```ts
 * import { startPgliteSharedWorker } from '@row-chat/prisma-pglite-adapter/shared-worker';
 * import { createPglite } from './pglite';
 *
 * startPgliteSharedWorker({ createPglite });
 * ```
 */
export function startPgliteSharedWorker(
  options: StartPgliteSharedWorkerOptions,
): void {
  const workerId = options.workerId ?? 'pglite';
  const bc = new BroadcastChannel(`pglite-broadcast:${workerId}`);
  const connectedTabs = new Set<string>();
  const pgliteReady = options.createPglite();

  // Keep the worker's event loop active so Chrome doesn't terminate it
  // between tab refreshes (Chrome kills SharedWorkers as soon as the last
  // port closes, unlike Safari which is more lenient).
  setInterval(() => {}, 500);

  bc.onmessage = async (e: MessageEvent) => {
    if (e.data.type === 'tab-here') {
      const tabId = e.data.id as string;
      if (!connectedTabs.has(tabId)) {
        connectedTabs.add(tabId);
        connectTab(tabId, await pgliteReady, connectedTabs);
      }
    }
  };

  // Per-tab handshake: send "here", wait for "init", reply "ready" with the
  // worker id so the client knows which broadcast channel to attach to.
  self.addEventListener('connect', (e: Event) => {
    const port = (e as MessageEvent).ports[0];
    port.postMessage({ type: 'here' });
    port.addEventListener('message', (msg: MessageEvent) => {
      if (msg.data.type === 'init') {
        port.postMessage({ type: 'ready', id: workerId });
      }
    });
    port.start();
  });
}

function connectTab(
  tabId: string,
  db: PGliteInterface,
  connectedTabs: Set<string>,
) {
  const dbi = db as unknown as PGlitePrivate;
  const tabBc = new BroadcastChannel(`pglite-tab:${tabId}`);
  let releaseQuery: (() => void) | null = null;
  let releaseTransaction: (() => void) | null = null;

  // Fires when the tab releases its pglite-tab-close lock (tab close /
  // worker terminate). Explicitly ROLLBACK any in-progress transaction so a
  // crashed tab doesn't leave the shared connection in a half-open state.
  navigator.locks.request(
    `pglite-tab-close:${tabId}`,
    () =>
      new Promise<void>((resolve) => {
        if (releaseTransaction) {
          void db.exec('ROLLBACK').catch(() => {});
          releaseTransaction();
          releaseTransaction = null;
        }
        releaseQuery?.();
        releaseQuery = null;
        tabBc.close();
        connectedTabs.delete(tabId);
        resolve();
      }),
  );

  const rpc: Record<string, (...args: unknown[]) => Promise<unknown>> = {
    async getDebugLevel() {
      return db.debug;
    },
    async close() {
      /* never close the shared db */
    },
    async execProtocol(data: unknown) {
      const r = await db.execProtocol(data as Uint8Array);
      return { messages: r.messages, data: ownBuffer(r.data) };
    },
    async execProtocolRaw(data: unknown) {
      return ownBuffer(await db.execProtocolRaw(data as Uint8Array));
    },
    async execProtocolStream(data: unknown) {
      return db.execProtocolStream(data as Uint8Array);
    },
    async execProtocolRawStream(data: unknown, ...rest: unknown[]) {
      return dbi.execProtocolRawStream(data as Uint8Array, ...rest);
    },
    async dumpDataDir(compression: unknown) {
      return db.dumpDataDir(
        compression as 'none' | 'gzip' | 'auto' | undefined,
      );
    },
    async syncToFs() {
      return dbi.syncToFs?.();
    },
    async _handleBlob(blob: unknown) {
      return dbi._handleBlob(blob as File | Blob | undefined);
    },
    async _getWrittenBlob() {
      return dbi._getWrittenBlob();
    },
    async _cleanupBlob() {
      return dbi._cleanupBlob();
    },
    async _checkReady() {
      return dbi._checkReady();
    },
    async _acquireQueryLock() {
      return new Promise<void>((resolve) => {
        dbi._runExclusiveQuery(
          () =>
            new Promise<void>((release) => {
              releaseQuery = release;
              resolve();
            }),
        );
      });
    },
    async _releaseQueryLock() {
      releaseQuery?.();
      releaseQuery = null;
    },
    async _acquireTransactionLock() {
      return new Promise<void>((resolve) => {
        dbi._runExclusiveTransaction(
          () =>
            new Promise<void>((release) => {
              releaseTransaction = release;
              resolve();
            }),
        );
      });
    },
    async _releaseTransactionLock() {
      releaseTransaction?.();
      releaseTransaction = null;
    },
  };

  tabBc.addEventListener('message', async (e: MessageEvent) => {
    if (e.data.type !== 'rpc-call') return;
    const { callId, method, args } = e.data as {
      callId: string;
      method: string;
      args: unknown[];
    };
    const fn = rpc[method];
    if (!fn) {
      tabBc.postMessage({
        type: 'rpc-error',
        callId,
        error: { message: `Unknown method: ${method}` },
      });
      return;
    }
    try {
      tabBc.postMessage({
        type: 'rpc-return',
        callId,
        result: await fn(...args),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      tabBc.postMessage({ type: 'rpc-error', callId, error: { message } });
    }
  });

  tabBc.postMessage({ type: 'connected' });
}

// Ensure a Uint8Array owns its buffer (not a view into a larger one) so the
// structured-clone over BroadcastChannel doesn't transfer surrounding bytes.
function ownBuffer(data: Uint8Array): Uint8Array {
  if (data.byteLength === data.buffer.byteLength) return data;
  const copy = new ArrayBuffer(data.byteLength);
  new Uint8Array(copy).set(data);
  return new Uint8Array(copy);
}
