export type SqliteResultSet = {
  columnNames: string[];
  declTypes: (string | null)[];
  rows: unknown[][];
};

export type SqliteWasmRemote = {
  queryRaw(params: { sql: string; args: unknown[] }): Promise<SqliteResultSet>;
  executeRaw(sql: string, args: unknown[]): Promise<number>;
  executeScript(script: string): Promise<void>;
  beginTransaction(): Promise<void>;
  createSavepoint(name: string): Promise<void>;
  rollbackToSavepoint(name: string): Promise<void>;
  releaseSavepoint(name: string): Promise<void>;
  close(): Promise<void>;
};

export type Sqlite3Subset = {
  capi: {
    sqlite3_column_decltype(
      stmtPointer: unknown,
      columnIndex: number,
    ): string | null;
  };
};

export type Sqlite3DB = {
  prepare(sql: string): {
    bind(args: unknown[]): void;
    columnCount: number;
    getColumnName(i: number): string;
    step(): boolean;
    get(target: unknown[]): unknown[];
    finalize(): void;
    pointer: unknown;
  };
  exec(sql: string, options?: { bind: unknown[] }): void;
  changes(): number;
  close(): void;
  pointer: unknown;
};

export function createSqliteWasmRemote(
  db: Sqlite3DB,
  sqlite3: Sqlite3Subset,
): SqliteWasmRemote {
  return {
    async queryRaw({
      sql,
      args,
    }: {
      sql: string;
      args: unknown[];
    }): Promise<SqliteResultSet> {
      const stmt = db.prepare(sql);
      try {
        if (args.length > 0) stmt.bind(args);
        const n: number = stmt.columnCount;
        if (n === 0) {
          stmt.step();
          return { columnNames: [], declTypes: [], rows: [] };
        }
        const columnNames = Array.from({ length: n }, (_, i) =>
          stmt.getColumnName(i),
        );
        const declTypes = Array.from({ length: n }, (_, i) =>
          sqlite3.capi.sqlite3_column_decltype(stmt.pointer!, i),
        );
        const rows: unknown[][] = [];
        while (stmt.step()) rows.push(stmt.get([]) as unknown[]);
        return { columnNames, declTypes, rows };
      } finally {
        stmt.finalize();
      }
    },

    async executeRaw(sql: string, args: unknown[]): Promise<number> {
      if (args.length > 0) db.exec(sql, { bind: args });
      else db.exec(sql);
      return db.changes() as number;
    },

    async executeScript(script: string): Promise<void> {
      db.exec(script);
    },

    async beginTransaction(): Promise<void> {
      db.exec('BEGIN');
    },

    async createSavepoint(name: string): Promise<void> {
      db.exec(`SAVEPOINT ${quoteIdent(name)}`);
    },

    async rollbackToSavepoint(name: string): Promise<void> {
      db.exec(`ROLLBACK TO SAVEPOINT ${quoteIdent(name)}`);
    },

    async releaseSavepoint(name: string): Promise<void> {
      db.exec(`RELEASE SAVEPOINT ${quoteIdent(name)}`);
    },

    async close(): Promise<void> {
      db.close();
    },
  };
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}
