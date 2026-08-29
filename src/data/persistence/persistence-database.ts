export interface PersistenceRows {
  toArray(): unknown[];
}

export interface PersistenceStatement {
  query(...values: unknown[]): Promise<PersistenceRows>;
  close(): Promise<void>;
}

export interface PersistenceDatabase {
  query(sql: string): Promise<PersistenceRows>;
  prepare(sql: string): Promise<PersistenceStatement>;
}
