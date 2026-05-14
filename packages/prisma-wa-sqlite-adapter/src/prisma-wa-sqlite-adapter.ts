import type { ArgType } from '@prisma/driver-adapter-utils';
import { DriverAdapterError } from '@prisma/driver-adapter-utils';
import { convertError } from './prisma-wa-sqlite-errors.ts';
import type { WaSqliteRemote } from './prisma-wa-sqlite-remote.ts';
import { resolveResultSet } from './prisma-wa-sqlite-result-set.ts';

export {
  createWaSqliteRemote,
  type SqliteResultSet,
  type WaSqliteAPI,
  type WaSqliteRemote,
} from './prisma-wa-sqlite-remote.ts';

export type WaSqliteAdapterOptions = {
  timestampFormat?:
    | 'epoch-ms'
    | 'iso8601'
    | 'iso8601-micros'
    | 'iso8601-offset';
};

function formatDate(
  value: Date,
  options: WaSqliteAdapterOptions | undefined,
): string | number {
  const format = options?.timestampFormat ?? 'iso8601-offset';
  switch (format) {
    case 'epoch-ms':
      return value.getTime();
    case 'iso8601':
      return value.toISOString();
    case 'iso8601-micros':
      return value.toISOString().replace(/Z$/, '000Z');
    case 'iso8601-offset':
      return value.toISOString().replace(/Z$/, '+00:00');
    default:
      throw new Error(`Unknown timestamp format: ${format}`);
  }
}

function prepareArg(
  value: unknown,
  argType: ArgType | undefined,
  options: WaSqliteAdapterOptions | undefined,
): unknown {
  if (value === null) return null;
  switch (argType?.scalarType) {
    case 'int':
      if (typeof value === 'string') return parseInt(value, 10);
      break;
    case 'float':
    case 'decimal':
      if (typeof value === 'string') return parseFloat(value);
      break;
    case 'bigint':
      if (typeof value === 'string') return BigInt(value);
      break;
    case 'boolean':
      return value ? 1 : 0;
    case 'datetime':
      if (typeof value === 'string') value = new Date(value);
      break;
    case 'bytes': {
      if (typeof value === 'string') {
        const binary = atob(value);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes;
      }
      return value;
    }
  }
  if (value instanceof Date) return formatDate(value, options);
  if (typeof value === 'bigint') return value;
  return value;
}

// Per-tab serialization. wa-sqlite is async at the C-API level: every
// `step`/`prepare_v2` call yields. Without a mutex two concurrent Prisma
// queries can interleave their prepare/bind/step sequences on the same
// connection and corrupt each other.
class Mutex {
  #locked = false;
  #queue: Array<() => void> = [];

  acquire(): Promise<() => void> {
    return new Promise((resolve) => {
      const release = () => {
        const next = this.#queue.shift();
        if (next) next();
        else this.#locked = false;
      };
      if (this.#locked) {
        this.#queue.push(() => resolve(release));
      } else {
        this.#locked = true;
        resolve(release);
      }
    });
  }
}

class WaSqliteTransaction {
  readonly provider = 'sqlite' as const;
  readonly adapterName = 'wa-sqlite';
  readonly options = { usePhantomQuery: false };
  private readonly remote: WaSqliteRemote;
  private readonly release: () => void;
  private readonly adapterOptions: WaSqliteAdapterOptions | undefined;

  constructor(
    remote: WaSqliteRemote,
    release: () => void,
    adapterOptions: WaSqliteAdapterOptions | undefined,
  ) {
    this.remote = remote;
    this.release = release;
    this.adapterOptions = adapterOptions;
  }

  async queryRaw({
    sql,
    args,
    argTypes,
  }: {
    sql: string;
    args: unknown[];
    argTypes?: ArgType[];
  }) {
    try {
      const raw = await this.remote.queryRaw({
        sql,
        args: args.map((arg, i) =>
          prepareArg(arg, argTypes?.[i], this.adapterOptions),
        ),
      });
      return resolveResultSet(raw);
    } catch (error) {
      return convertError(error);
    }
  }

  async executeRaw({
    sql,
    args,
    argTypes,
  }: {
    sql: string;
    args: unknown[];
    argTypes?: ArgType[];
  }) {
    try {
      return await this.remote.executeRaw(
        sql,
        args.map((arg, i) =>
          prepareArg(arg, argTypes?.[i], this.adapterOptions),
        ),
      );
    } catch (error) {
      return convertError(error);
    }
  }

  // commit/rollback are lifecycle hooks. Prisma's engine issues the actual
  // COMMIT/ROLLBACK SQL via executeRaw before calling these — our job is
  // just to release the mutex so the next caller can start work.
  async commit(): Promise<void> {
    this.release();
  }

  async rollback(): Promise<void> {
    this.release();
  }

  async createSavepoint(name: string): Promise<void> {
    await this.remote.createSavepoint(name);
  }

  async rollbackToSavepoint(name: string): Promise<void> {
    await this.remote.rollbackToSavepoint(name);
  }

  async releaseSavepoint(name: string): Promise<void> {
    await this.remote.releaseSavepoint(name);
  }
}

class WaSqliteAdapter {
  readonly provider = 'sqlite' as const;
  readonly adapterName = 'wa-sqlite';
  private readonly remote: WaSqliteRemote;
  private readonly adapterOptions: WaSqliteAdapterOptions | undefined;
  #mutex = new Mutex();

  constructor(
    remote: WaSqliteRemote,
    adapterOptions: WaSqliteAdapterOptions | undefined,
  ) {
    this.remote = remote;
    this.adapterOptions = adapterOptions;
  }

  async queryRaw({
    sql,
    args,
    argTypes,
  }: {
    sql: string;
    args: unknown[];
    argTypes?: ArgType[];
  }) {
    const release = await this.#mutex.acquire();
    try {
      const raw = await this.remote.queryRaw({
        sql,
        args: args.map((arg, i) =>
          prepareArg(arg, argTypes?.[i], this.adapterOptions),
        ),
      });
      return resolveResultSet(raw);
    } catch (error) {
      return convertError(error);
    } finally {
      release();
    }
  }

  async executeRaw({
    sql,
    args,
    argTypes,
  }: {
    sql: string;
    args: unknown[];
    argTypes?: ArgType[];
  }) {
    const release = await this.#mutex.acquire();
    try {
      return await this.remote.executeRaw(
        sql,
        args.map((arg, i) =>
          prepareArg(arg, argTypes?.[i], this.adapterOptions),
        ),
      );
    } catch (error) {
      return convertError(error);
    } finally {
      release();
    }
  }

  async executeScript(script: string): Promise<void> {
    const release = await this.#mutex.acquire();
    try {
      await this.remote.executeScript(script);
    } catch (error) {
      convertError(error);
    } finally {
      release();
    }
  }

  async startTransaction(
    isolationLevel?: string,
  ): Promise<WaSqliteTransaction> {
    if (isolationLevel && isolationLevel !== 'SERIALIZABLE') {
      throw new DriverAdapterError({
        kind: 'InvalidIsolationLevel',
        level: isolationLevel,
      });
    }
    const release = await this.#mutex.acquire();
    try {
      await this.remote.beginTransaction();
    } catch (error) {
      release();
      throw error;
    }
    return new WaSqliteTransaction(this.remote, release, this.adapterOptions);
  }

  async dispose(): Promise<void> {
    await this.remote.close();
  }
}

export class WaSqliteAdapterFactory {
  readonly provider = 'sqlite' as const;
  readonly adapterName = 'wa-sqlite';
  private readonly remote: WaSqliteRemote;
  private readonly adapterOptions: WaSqliteAdapterOptions | undefined;

  constructor(remote: WaSqliteRemote, options?: WaSqliteAdapterOptions) {
    this.remote = remote;
    this.adapterOptions = options;
  }

  async connect(): Promise<WaSqliteAdapter> {
    return new WaSqliteAdapter(this.remote, this.adapterOptions);
  }

  async connectToShadowDb(): Promise<WaSqliteAdapter> {
    throw new Error(
      'connectToShadowDb is not supported in the browser. Run migrations at build time.',
    );
  }
}
