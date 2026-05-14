import { type ColumnType, ColumnTypeEnum } from '@prisma/driver-adapter-utils';
import type { SqliteResultSet } from './prisma-wa-sqlite-remote.ts';

export type PrismaResultSet = {
  columnNames: string[];
  columnTypes: ColumnType[];
  rows: unknown[][];
};

export function resolveResultSet(raw: SqliteResultSet): PrismaResultSet {
  const columnTypes: ColumnType[] = raw.declTypes.map((decl, i) => {
    const mapped = mapDeclType(decl);
    if (mapped !== null) return mapped;
    for (const row of raw.rows) {
      if (row[i] !== null) return inferColType(row[i]);
    }
    return ColumnTypeEnum.Int32;
  });
  return {
    columnNames: raw.columnNames,
    columnTypes,
    rows: raw.rows.map((row) => mapRow(row, columnTypes)),
  };
}

function mapDeclType(declType: string | null): ColumnType | null {
  if (declType === null) return null;
  switch (declType.toUpperCase()) {
    case '':
      return null;
    case 'DECIMAL':
      return ColumnTypeEnum.Numeric;
    case 'FLOAT':
      return ColumnTypeEnum.Float;
    case 'DOUBLE':
    case 'DOUBLE PRECISION':
    case 'NUMERIC':
    case 'REAL':
      return ColumnTypeEnum.Double;
    case 'TINYINT':
    case 'SMALLINT':
    case 'MEDIUMINT':
    case 'INT':
    case 'INTEGER':
    case 'SERIAL':
    case 'INT2':
      return ColumnTypeEnum.Int32;
    case 'BIGINT':
    case 'UNSIGNED BIG INT':
    case 'INT8':
      return ColumnTypeEnum.Int64;
    case 'DATETIME':
    case 'TIMESTAMP':
      return ColumnTypeEnum.DateTime;
    case 'TIME':
      return ColumnTypeEnum.Time;
    case 'DATE':
      return ColumnTypeEnum.Date;
    case 'TEXT':
    case 'CLOB':
    case 'CHARACTER':
    case 'VARCHAR':
    case 'VARYING CHARACTER':
    case 'NCHAR':
    case 'NATIVE CHARACTER':
    case 'NVARCHAR':
      return ColumnTypeEnum.Text;
    case 'BLOB':
      return ColumnTypeEnum.Bytes;
    case 'BOOLEAN':
      return ColumnTypeEnum.Boolean;
    case 'JSONB':
      return ColumnTypeEnum.Json;
    default:
      return null;
  }
}

function inferColType(value: unknown): ColumnType {
  if (typeof value === 'number') return ColumnTypeEnum.UnknownNumber;
  if (typeof value === 'bigint') return ColumnTypeEnum.Int64;
  if (typeof value === 'boolean') return ColumnTypeEnum.Boolean;
  if (value instanceof Uint8Array) return ColumnTypeEnum.Bytes;
  return ColumnTypeEnum.Text;
}

function mapRow(row: unknown[], columnTypes: ColumnType[]): unknown[] {
  const result: unknown[] = [];
  for (let i = 0; i < row.length; i++) {
    const value = row[i];
    if (
      typeof value === 'number' &&
      (columnTypes[i] === ColumnTypeEnum.Int32 ||
        columnTypes[i] === ColumnTypeEnum.Int64) &&
      !Number.isInteger(value)
    ) {
      result[i] = Math.trunc(value);
      continue;
    }
    if (
      (typeof value === 'number' || typeof value === 'bigint') &&
      columnTypes[i] === ColumnTypeEnum.DateTime
    ) {
      result[i] = new Date(Number(value)).toISOString();
      continue;
    }
    if (typeof value === 'bigint') {
      const n = Number(value);
      result[i] = Number.isSafeInteger(n) ? n : value.toString();
      continue;
    }
    result[i] = value;
  }
  return result;
}
