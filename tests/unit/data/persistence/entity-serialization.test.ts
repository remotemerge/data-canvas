import { describe, expect, test } from 'bun:test';
import { createEmptyWorkspace } from '@/domain/workspace/workspace.ts';
import {
  deserializeEntity,
  isWorkspacePayload,
  serializeEntity,
} from '@/data/persistence/schema/entity-serialization.ts';

describe('workspace serialization', () => {
  test('round-trips the normalized workspace', () => {
    const workspace = createEmptyWorkspace('Saved workspace');
    const restored = deserializeEntity(serializeEntity(workspace));
    expect(isWorkspacePayload(restored)).toBe(true);
    expect(restored).toEqual(workspace);
  });
  test('rejects an incomplete payload', () => expect(isWorkspacePayload({ id: 'x' })).toBe(false));
});
