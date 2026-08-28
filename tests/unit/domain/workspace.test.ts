import { describe, expect, test } from 'bun:test';
import { CURRENT_SCHEMA_VERSION, createEmptyWorkspace, DEFAULT_LAYOUT_COLUMNS } from '@/domain/workspace/workspace.ts';
import { isNumericType, isTemporalType, isTextType, LOGICAL_TYPES } from '@/domain/logical-type.ts';
import type { LogicalType } from '@/domain/logical-type.ts';
import { createEntityId, ID_PREFIX } from '@/shared/ids/entity-id.ts';

describe('createEmptyWorkspace', () => {
  test('starts at revision 0 with the origin schema version', () => {
    const workspace = createEmptyWorkspace();

    expect(workspace.revision).toBe(0);
    expect(workspace.schemaVersion).toBe(1);
    expect(workspace.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  test('normalized entity maps are empty records, not arrays', () => {
    const workspace = createEmptyWorkspace();

    for (const map of [
      workspace.datasets,
      workspace.visualizations,
      workspace.filters,
      workspace.selections,
      workspace.metrics,
      workspace.annotations,
    ]) {
      expect(Array.isArray(map)).toBe(false);
      expect(Object.keys(map)).toHaveLength(0);
    }
  });

  test('has no active dataset and an empty layout', () => {
    const workspace = createEmptyWorkspace();

    expect(workspace.activeDatasetId).toBeUndefined();
    expect(workspace.layout.columns).toBe(DEFAULT_LAYOUT_COLUMNS);
    expect(workspace.layout.items).toHaveLength(0);
  });

  test('uses the provided name and a workspace-prefixed id', () => {
    const workspace = createEmptyWorkspace('Q4 analysis');

    expect(workspace.name).toBe('Q4 analysis');
    expect(workspace.id.startsWith(`${ID_PREFIX.workspace}_`)).toBe(true);
  });

  test('timestamps are valid ISO strings', () => {
    const workspace = createEmptyWorkspace();

    expect(Number.isNaN(Date.parse(workspace.createdAt))).toBe(false);
    expect(Number.isNaN(Date.parse(workspace.updatedAt))).toBe(false);
  });

  test('each workspace gets a distinct identity', () => {
    expect(createEmptyWorkspace().id).not.toBe(createEmptyWorkspace().id);
  });
});

describe('createEntityId', () => {
  test('produces unique ids across many iterations', () => {
    const iterations = 5_000;
    const ids = new Set<string>();

    for (let index = 0; index < iterations; index += 1) {
      ids.add(createEntityId(ID_PREFIX.dataset));
    }

    expect(ids.size).toBe(iterations);
  });

  test('prefixes every id with its entity kind', () => {
    for (const prefix of Object.values(ID_PREFIX)) {
      expect(createEntityId(prefix).startsWith(`${prefix}_`)).toBe(true);
    }
  });

  test('never derives identity from user input, so ids are opaque uuids', () => {
    const id = createEntityId(ID_PREFIX.dataset);
    const [, uuid] = id.split('_');

    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});

describe('logical type helpers', () => {
  // Exhaustive rather than sampled. These helpers back operator and visual-channel compatibility
  // rules, so a newly added LogicalType must fail here until someone classifies it.
  const expected: Record<LogicalType, { numeric: boolean; temporal: boolean; text: boolean }> = {
    number: { numeric: true, temporal: false, text: false },
    string: { numeric: false, temporal: false, text: true },
    boolean: { numeric: false, temporal: false, text: false },
    date: { numeric: false, temporal: true, text: false },
    timestamp: { numeric: false, temporal: true, text: false },
    category: { numeric: false, temporal: false, text: true },
    unknown: { numeric: false, temporal: false, text: false },
  };

  test('LOGICAL_TYPES covers every member of the union exactly once', () => {
    const classified = Object.keys(expected) as LogicalType[];

    expect(LOGICAL_TYPES.toSorted()).toEqual(classified.toSorted());
    expect(new Set(LOGICAL_TYPES).size).toBe(LOGICAL_TYPES.length);
  });

  test.each(LOGICAL_TYPES.map((type) => [type] as const))('classifies %s correctly', (type) => {
    const want = expected[type];

    expect(isNumericType(type)).toBe(want.numeric);
    expect(isTemporalType(type)).toBe(want.temporal);
    expect(isTextType(type)).toBe(want.text);
  });
});
