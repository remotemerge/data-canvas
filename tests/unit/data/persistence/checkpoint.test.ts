import { describe, expect, test } from 'bun:test';
import { createCheckpointScheduler } from '@/data/persistence/checkpoint.ts';
import { createEmptyWorkspace } from '@/domain/workspace/workspace.ts';

describe('checkpoint scheduler', () => {
  test('coalesces pending states', async () => {
    const revisions: number[] = [];
    const scheduler = createCheckpointScheduler(async ({ workspace }) => {
      revisions.push(workspace.revision);
    }, 60_000);
    const workspace = createEmptyWorkspace();
    scheduler.schedule({ workspace: { ...workspace, revision: 1 }, history: [] });
    scheduler.schedule({ workspace: { ...workspace, revision: 2 }, history: [] });
    await scheduler.flush();
    expect(revisions).toEqual([2]);
    scheduler.dispose();
  });
});
