import type { PersistenceDatabase } from '@/data/persistence/persistence-database.ts';

export const METADATA_TABLES = [
  'app_workspace_meta',
  'app_dataset_meta',
  'app_visualizations',
  'app_filters',
  'app_metrics',
  'app_annotations',
  'app_action_history',
] as const;

export const createMetadataTables = async (db: PersistenceDatabase): Promise<void> => {
  await db.query(
    'CREATE TABLE IF NOT EXISTS app_workspace_meta (id VARCHAR PRIMARY KEY, schema_version INTEGER NOT NULL, revision BIGINT NOT NULL, payload VARCHAR NOT NULL)',
  );
  for (const table of METADATA_TABLES.slice(1)) {
    // DDL shares one connection. Keep table creation ordered so a failure has a stable boundary.
    // eslint-disable-next-line no-await-in-loop
    await db.query(`CREATE TABLE IF NOT EXISTS ${table} (id VARCHAR PRIMARY KEY, payload VARCHAR NOT NULL)`);
  }
};
