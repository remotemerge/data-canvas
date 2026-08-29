import type { StoredWorkspace, WorkspaceMigration } from '@/data/persistence/migrations/migration-types.ts';

/**
 * Collections that a version 1 payload may predate.
 *
 * Schema 2 is the first version this application ever wrote, so no build has produced a genuine v1
 * file. Version 1 exists as the landing point for pre-versioning data (see `normalizeStoredVersion`),
 * which is the one case where a payload can be missing whole entity maps that hydration and the
 * domain validators both assume are present.
 *
 * Backfilling is the only defensible transformation here. Inventing field renames for a version no
 * build emitted would be fabricating history, and the resulting migration could never be verified
 * against a real fixture.
 */
const REQUIRED_COLLECTIONS = [
  'datasets',
  'derivedColumns',
  'relationships',
  'visualizations',
  'filters',
  'tableSorts',
  'selections',
  'metrics',
  'annotations',
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Fills in the entity maps and layout a pre-versioning workspace may lack.
 *
 * Absent collections become empty rather than being dropped, so a workspace that predates a feature
 * hydrates as one that simply has none of that entity — which is true — instead of failing
 * validation on a missing key.
 */
export const v1ToV2: WorkspaceMigration = {
  from: 1,
  to: 2,
  migrate: (workspace: StoredWorkspace): StoredWorkspace => {
    const migrated: StoredWorkspace = { ...workspace };

    for (const collection of REQUIRED_COLLECTIONS) {
      if (!isRecord(migrated[collection])) migrated[collection] = {};
    }

    const layout = migrated['layout'];

    if (!isRecord(layout) || !Array.isArray(layout['items'])) {
      migrated['layout'] = { columns: 12, items: [] };
    }

    return migrated;
  },
};
