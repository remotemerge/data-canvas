import { describe, expect, test } from 'bun:test';
import {
  LEGACY_SCHEMA_VERSION,
  migrateStoredWorkspace,
  normalizeStoredVersion,
  WORKSPACE_MIGRATIONS,
} from '@/data/persistence/migrations/migrate-workspace.ts';
import type { StoredWorkspace } from '@/data/persistence/migrations/migration-types.ts';
import { isWorkspacePayload } from '@/data/persistence/schema/entity-serialization.ts';
import { CURRENT_SCHEMA_VERSION, createEmptyWorkspace } from '@/domain/workspace/workspace.ts';

const legacyFixture = async (): Promise<StoredWorkspace> =>
  (await Bun.file('tests/fixtures/workspaces/v1/minimal.json').json()) as StoredWorkspace;

describe('migration registry', () => {
  test('the registered steps form an unbroken chain to the current version', () => {
    // Guards the rule that raising CURRENT_SCHEMA_VERSION without registering the matching step is
    // a defect: without this, the gap would only surface when a user's saved workspace failed.
    for (const migration of WORKSPACE_MIGRATIONS) {
      expect(migration.to).toBe(migration.from + 1);
    }

    const versions = WORKSPACE_MIGRATIONS.map((migration) => migration.from);

    expect(new Set(versions).size).toBe(versions.length);

    let version = LEGACY_SCHEMA_VERSION;
    while (version < CURRENT_SCHEMA_VERSION) {
      const step = WORKSPACE_MIGRATIONS.find((migration) => migration.from === version);
      expect(step, `no migration registered from schema version ${version}`).toBeDefined();
      version = step?.to ?? version + 1;
    }

    expect(version).toBe(CURRENT_SCHEMA_VERSION);
  });
});

describe('stored version resolution', () => {
  test('treats a missing version as the pre-versioning legacy version', () => {
    expect(normalizeStoredVersion({ id: 'ws_1' })).toBe(LEGACY_SCHEMA_VERSION);
  });

  test('rejects a malformed version rather than guessing one', () => {
    // A corrupt version must not be inferred from which fields are present; that would migrate a
    // truncated file as though it were merely old.
    expect(normalizeStoredVersion({ schemaVersion: 'two' })).toBeNull();
    expect(normalizeStoredVersion({ schemaVersion: 1.5 })).toBeNull();
    expect(normalizeStoredVersion({ schemaVersion: 0 })).toBeNull();
    expect(normalizeStoredVersion({ schemaVersion: -1 })).toBeNull();
  });
});

describe('workspace migration', () => {
  test('migrates the stored v1 fixture to a payload the domain guard accepts', async () => {
    const result = migrateStoredWorkspace(await legacyFixture());

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value['schemaVersion']).toBe(CURRENT_SCHEMA_VERSION);
    // The fixture predates these collections entirely; hydration and the validators both assume them.
    expect(result.value['derivedColumns']).toEqual({});
    expect(result.value['relationships']).toEqual({});
    expect(result.value['tableSorts']).toEqual({});
    expect(isWorkspacePayload(result.value)).toBe(true);
  });

  test('preserves the semantic state the legacy workspace already carried', async () => {
    const fixture = await legacyFixture();
    const result = migrateStoredWorkspace(fixture);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value['id']).toBe(fixture['id']);
    expect(result.value['name']).toBe(fixture['name']);
    expect(result.value['revision']).toBe(fixture['revision']);
    expect(result.value['createdAt']).toBe(fixture['createdAt']);
  });

  test('does not mutate the payload it was given', async () => {
    const fixture = await legacyFixture();
    const before = JSON.stringify(fixture);

    migrateStoredWorkspace(fixture);

    // A migration that mutated its input would leave a half-migrated workspace behind on the very
    // path where the chain is meant to be abandoned intact.
    expect(JSON.stringify(fixture)).toBe(before);
  });

  test('running the chain twice reaches the same result', async () => {
    const first = migrateStoredWorkspace(await legacyFixture());

    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = migrateStoredWorkspace(first.value);

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value).toEqual(first.value);
  });

  test('passes a current-version workspace through unchanged', () => {
    const workspace = createEmptyWorkspace('Current') as unknown as StoredWorkspace;
    const result = migrateStoredWorkspace(workspace);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual(workspace);
  });

  test('refuses a workspace written by a newer build', () => {
    const result = migrateStoredWorkspace({
      ...(createEmptyWorkspace('Future') as unknown as StoredWorkspace),
      schemaVersion: CURRENT_SCHEMA_VERSION + 1,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('WORKSPACE_VERSION_UNSUPPORTED');
    // Best-effort hydration would discard fields this build has no code for, then checkpoint the
    // truncated result back over the newer file.
    expect(result.error.details).toEqual({
      storedVersion: CURRENT_SCHEMA_VERSION + 1,
      supportedVersion: CURRENT_SCHEMA_VERSION,
    });
  });

  test('refuses a workspace whose version is unreadable', () => {
    const result = migrateStoredWorkspace({ id: 'ws_1', schemaVersion: 'two' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('WORKSPACE_VERSION_UNSUPPORTED');
  });

  test('never leaks a dataset value into the error message', () => {
    const result = migrateStoredWorkspace({ schemaVersion: 999, secret: 'confidential-cell-value' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(JSON.stringify(result.error)).not.toContain('confidential-cell-value');
  });
});
