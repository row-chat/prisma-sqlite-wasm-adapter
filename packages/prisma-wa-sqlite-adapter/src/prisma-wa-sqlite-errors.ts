import { DriverAdapterError } from '@prisma/driver-adapter-utils';

export function convertError(error: unknown): never {
  if (error instanceof Error) {
    // wa-sqlite throws SQLiteError with `.code`. Some hosts also expose
    // `.resultCode` (matching the official sqlite-wasm shape) — accept both.
    const raw = error as { code?: number; resultCode?: number };
    const code = raw.code ?? raw.resultCode;
    const message = error.message;

    if (code !== undefined) {
      if (code === 2067 || code === 1555) {
        const fields = parseConstraintFields(message);
        throw new DriverAdapterError({
          kind: 'UniqueConstraintViolation',
          constraint: fields !== undefined ? { fields } : undefined,
          originalMessage: message,
        });
      }
      if (code === 1299) {
        const fields = parseConstraintFields(message);
        throw new DriverAdapterError({
          kind: 'NullConstraintViolation',
          constraint: fields !== undefined ? { fields } : undefined,
          originalMessage: message,
        });
      }
      if (code === 787 || code === 1811) {
        throw new DriverAdapterError({
          kind: 'ForeignKeyConstraintViolation',
          constraint: { foreignKey: {} },
          originalMessage: message,
        });
      }
      if ((code & 0xff) === 5) {
        throw new DriverAdapterError({
          kind: 'SocketTimeout',
          originalMessage: message,
        });
      }
    }

    if (message.includes('no such table')) {
      throw new DriverAdapterError({
        kind: 'TableDoesNotExist',
        table: message.split(': ').at(1),
        originalMessage: message,
      });
    }
    if (message.includes('no such column')) {
      throw new DriverAdapterError({
        kind: 'ColumnNotFound',
        column: message.split(': ').at(1),
        originalMessage: message,
      });
    }
    if (message.includes('has no column named ')) {
      throw new DriverAdapterError({
        kind: 'ColumnNotFound',
        column: message.split('has no column named ').at(1),
        originalMessage: message,
      });
    }
  }
  throw error;
}

function parseConstraintFields(message: string): string[] | undefined {
  return message
    .split('constraint failed: ')
    .at(1)
    ?.split(', ')
    .map((f) => f.split('.').pop()!);
}
