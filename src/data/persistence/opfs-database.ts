export const OPFS_DATABASE_FILE = 'data-canvas.db';
export const OPFS_DATABASE_PATH = `opfs://${OPFS_DATABASE_FILE}`;

export type DatabaseStorage = 'opfs' | 'memory';

export const databasePath = (storage: DatabaseStorage): string =>
  storage === 'memory' ? ':memory:' : OPFS_DATABASE_PATH;
