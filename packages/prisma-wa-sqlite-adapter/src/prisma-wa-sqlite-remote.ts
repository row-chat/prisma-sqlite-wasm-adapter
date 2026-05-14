export type SqliteResultSet = {
  columnNames: string[];
  declTypes: (string | null)[];
  rows: unknown[][];
};

export type WaSqliteRemote = {
  queryRaw(params: { sql: string; args: unknown[] }): Promise<SqliteResultSet>;
  executeRaw(sql: string, args: unknown[]): Promise<number>;
  executeScript(script: string): Promise<void>;
  beginTransaction(): Promise<void>;
  createSavepoint(name: string): Promise<void>;
  rollbackToSavepoint(name: string): Promise<void>;
  releaseSavepoint(name: string): Promise<void>;
  close(): Promise<void>;
};

// Structural subset of wa-sqlite's SQLiteAPI. Only the calls we make are
// declared, so consumers can pass the value returned from
// `SQLiteAsyncESMFactory(Module)` (or its sync sibling) without type friction.
export type WaSqliteAPI = {
  prepare_v2(
    db: number,
    sql: string | ArrayBufferView | ArrayBuffer,
  ): Promise<{ stmt: number; sql: number } | null>;
  bind_collection(
    stmt: number,
    bindings: unknown[] | Record<string, unknown>,
  ): Promise<number>;
  step(stmt: number): Promise<number>;
  column_count(stmt: number): number;
  column_name(stmt: number, i: number): string;
  column_decltype(stmt: number, i: number): string | null;
  column(stmt: number, i: number): unknown;
  finalize(stmt: number): Promise<number>;
  exec(
    db: number,
    sql: string,
    callback?: (row: unknown[], columns: string[]) => void,
  ): Promise<number>;
  changes(db: number): number;
  close(db: number): Promise<number>;
};

// wa-sqlite result-code constants we care about. SQLITE_ROW = 100,
// SQLITE_DONE = 101. Defined locally so we don't pull the whole wa-sqlite
// runtime in for two numbers.
const SQLITE_ROW = 100;

export function createWaSqliteRemote(
  sqlite3: WaSqliteAPI,
  db: number,
): WaSqliteRemote {
  return {
    async queryRaw({
      sql,
      args,
    }: {
      sql: string;
      args: unknown[];
    }): Promise<SqliteResultSet> {
      const prepared = await sqlite3.prepare_v2(db, sql);
      if (prepared === null) {
        return { columnNames: [], declTypes: [], rows: [] };
      }
      const { stmt } = prepared;
      try {
        if (args.length > 0) await sqlite3.bind_collection(stmt, args);
        const n = sqlite3.column_count(stmt);
        if (n === 0) {
          await sqlite3.step(stmt);
          return { columnNames: [], declTypes: [], rows: [] };
        }
        const columnNames = Array.from({ length: n }, (_, i) =>
          sqlite3.column_name(stmt, i),
        );
        const declTypes = Array.from({ length: n }, (_, i) =>
          sqlite3.column_decltype(stmt, i),
        );
        const rows: unknown[][] = [];
        while ((await sqlite3.step(stmt)) === SQLITE_ROW) {
          const row: unknown[] = new Array(n);
          for (let i = 0; i < n; i++) row[i] = sqlite3.column(stmt, i);
          rows.push(row);
        }
        return { columnNames, declTypes, rows };
      } finally {
        await sqlite3.finalize(stmt);
      }
    },

    async executeRaw(sql: string, args: unknown[]): Promise<number> {
      if (args.length === 0) {
        await sqlite3.exec(db, sql);
        return sqlite3.changes(db);
      }
      const prepared = await sqlite3.prepare_v2(db, sql);
      if (prepared === null) return 0;
      const { stmt } = prepared;
      try {
        await sqlite3.bind_collection(stmt, args);
        while ((await sqlite3.step(stmt)) === SQLITE_ROW) {
          // drain RETURNING rows; rowsAffected comes from changes()
        }
      } finally {
        await sqlite3.finalize(stmt);
      }
      return sqlite3.changes(db);
    },

    async executeScript(script: string): Promise<void> {
      await sqlite3.exec(db, script);
    },

    async beginTransaction(): Promise<void> {
      await sqlite3.exec(db, 'BEGIN');
    },

    async createSavepoint(name: string): Promise<void> {
      await sqlite3.exec(db, `SAVEPOINT ${quoteIdent(name)}`);
    },

    async rollbackToSavepoint(name: string): Promise<void> {
      await sqlite3.exec(db, `ROLLBACK TO SAVEPOINT ${quoteIdent(name)}`);
    },

    async releaseSavepoint(name: string): Promise<void> {
      await sqlite3.exec(db, `RELEASE SAVEPOINT ${quoteIdent(name)}`);
    },

    async close(): Promise<void> {
      await sqlite3.close(db);
    },
  };
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}
