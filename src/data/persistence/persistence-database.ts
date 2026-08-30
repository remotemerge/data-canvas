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
  /**
   * Pushes DuckDB's buffered pages out to the backing files.
   *
   * `CHECKPOINT` alone leaves an OPFS-backed database at zero bytes: the pages reach DuckDB's own
   * buffer manager but the OPFS sync access handle is only flushed by this call. Optional because
   * the in-memory database used by tests has nothing to flush.
   */
  flushFiles?(): Promise<void>;
}
