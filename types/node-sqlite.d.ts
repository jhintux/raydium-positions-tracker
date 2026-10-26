declare module "node:sqlite" {
  export type SqlValue = string | number | bigint | null | Uint8Array;

  export class StatementSync {
    run(...params: SqlValue[]): { changes: number; lastInsertRowid: number | bigint };
    get(...params: SqlValue[]): Record<string, SqlValue> | undefined;
    all(...params: SqlValue[]): Record<string, SqlValue>[];
    iterate(...params: SqlValue[]): IterableIterator<Record<string, SqlValue>>;
  }

  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
