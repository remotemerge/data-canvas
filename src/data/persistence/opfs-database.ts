export const OPFS_DATABASE_PATH = 'opfs://data-canvas.db';

export type DatabaseStorage = 'opfs' | 'memory';

export const databasePath = (storage: DatabaseStorage): string =>
  storage === 'memory' ? ':memory:' : OPFS_DATABASE_PATH;
