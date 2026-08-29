import type { StoredWorkspace, WorkspaceMigration } from '@/data/persistence/migrations/migration-types.ts';
import { v1ToV2 } from '@/data/persistence/migrations/v1-to-v2.ts';
import { CURRENT_SCHEMA_VERSION } from '@/domain/workspace/workspace.ts';
import { domainError, type DomainError } from '@/shared/errors/domain-error.ts';
import { err, ok, type Result } from '@/shared/result/result.ts';

/**
 * Every shipped transition, ordered.
 *
 * Registering a migration here is what makes a schema bump safe; raising `CURRENT_SCHEMA_VERSION`
 * without adding the matching step leaves a gap that `findStep` reports rather than silently
 * skipping. The ordering invariant is asserted by the migration tests, not assumed.
 */
export const WORKSPACE_MIGRATIONS: readonly WorkspaceMigration[] = [v1ToV2] as const;

/** The version assigned to data written before versioning existed. */
export const LEGACY_SCHEMA_VERSION = 1;

/**
 * Resolves the schema version of a payload.
 *
 * The single inference this module permits, and only for data written before a version field
 * existed. Once a payload carries a version, a missing or malformed one is a corruption signal
 * rather than an invitation to guess — inferring a version from which fields happen to be present
 * would let a truncated file be migrated as though it were merely old.
 */
export const normalizeStoredVersion = (workspace: StoredWorkspace): number | null => {
  const version = workspace['schemaVersion'];

  if (version === undefined) return LEGACY_SCHEMA_VERSION;
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) return null;

  return version;
};

const findStep = (from: number): WorkspaceMigration | undefined =>
  WORKSPACE_MIGRATIONS.find((migration) => migration.from === from);

/**
 * Migrates a stored workspace up to the current schema version.
 *
 * Runs one registered step at a time, so a failure names the transition that broke rather than a
 * single opaque jump. Nothing here writes: the caller receives a new payload and commits it only
 * after the domain validators accept it, which is what keeps a failed chain from overwriting the
 * original stored metadata.
 *
 * A payload from a *newer* build is refused outright. Its fields may carry semantics this build has
 * no code for, and a best-effort hydration would quietly discard them — then checkpoint the
 * truncated result back over the user's newer workspace, destroying it.
 */
export const migrateStoredWorkspace = (workspace: StoredWorkspace): Result<StoredWorkspace, DomainError> => {
  const version = normalizeStoredVersion(workspace);

  if (version === null) {
    return err(domainError('WORKSPACE_VERSION_UNSUPPORTED', 'The saved workspace has an unreadable schema version.'));
  }

  if (version > CURRENT_SCHEMA_VERSION) {
    return err(
      domainError(
        'WORKSPACE_VERSION_UNSUPPORTED',
        'This workspace was saved by a newer version of Data Canvas and cannot be opened.',
        { storedVersion: version, supportedVersion: CURRENT_SCHEMA_VERSION },
      ),
    );
  }

  let current = workspace;
  let currentVersion = version;

  while (currentVersion < CURRENT_SCHEMA_VERSION) {
    const step = findStep(currentVersion);

    if (step === undefined) {
      return err(
        domainError('WORKSPACE_VERSION_UNSUPPORTED', 'The saved workspace cannot be upgraded to the current format.', {
          storedVersion: currentVersion,
          supportedVersion: CURRENT_SCHEMA_VERSION,
        }),
      );
    }

    current = { ...step.migrate(current), schemaVersion: step.to };
    currentVersion = step.to;
  }

  return ok(current);
};
