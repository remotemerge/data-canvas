import { expect, test } from 'bun:test';
import { domainError } from '@/shared/errors/domain-error.ts';
import { errorResult } from '@/webmcp/results/tool-result.ts';
import { enforceOutputBudget, MAX_TOOL_OUTPUT_LENGTH } from '@/webmcp/results/enforce-output-budget.ts';

const parse = (serialized: string): Record<string, unknown> => JSON.parse(serialized) as Record<string, unknown>;

test('a stale write returns the current revision so the retry needs no extra read', () => {
  const output = parse(
    errorResult(
      domainError('STALE_WORKSPACE_REVISION', 'The workspace has changed.', {
        expectedRevision: 3,
        currentRevision: 5,
      }),
    ),
  );

  expect(output['ok']).toBe(false);
  expect(output['details']).toEqual({ expectedRevision: 3, currentRevision: 5 });
  expect(output['recovery']).toContain('currentRevision');
});

test('a recoverable failure names the tool that resolves it', () => {
  expect(parse(errorResult(domainError('DATASET_NOT_FOUND', 'Missing.')))['recovery']).toContain('get_workspace');
  expect(parse(errorResult(domainError('COLUMN_NOT_FOUND', 'Missing.')))['recovery']).toContain('get_dataset_schema');
  expect(parse(errorResult(domainError('NO_JOIN_PATH', 'Unreachable.')))['recovery']).toContain('list_relationships');
});

// The recovery hint tells the agent to read `details`, so trimming must not leave a dangling pointer.
test('recovery data survives an oversized error that forces trimming', () => {
  const output = JSON.parse(
    enforceOutputBudget(
      errorResult(
        domainError('STALE_WORKSPACE_REVISION', 'x'.repeat(4000), { expectedRevision: 3, currentRevision: 5 }),
      ),
    ),
  ) as Record<string, unknown>;

  expect(output['details']).toEqual({ expectedRevision: 3, currentRevision: 5 });
  expect(output['recovery']).toContain('currentRevision');
  expect(
    enforceOutputBudget(errorResult(domainError('STALE_WORKSPACE_REVISION', 'x'.repeat(4000), { currentRevision: 5 })))
      .length,
  ).toBeLessThanOrEqual(MAX_TOOL_OUTPUT_LENGTH);
});

test('an error without recovery guidance omits the field rather than inventing one', () => {
  const output = parse(errorResult(domainError('IMPORT_FAILED', 'The file could not be read.')));

  expect(output['code']).toBe('IMPORT_FAILED');
  expect('recovery' in output).toBe(false);
  expect('details' in output).toBe(false);
});
