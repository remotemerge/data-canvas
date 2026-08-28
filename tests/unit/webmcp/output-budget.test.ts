import { expect, test } from 'bun:test';
import { enforceOutputBudget, MAX_TOOL_OUTPUT_LENGTH } from '@/webmcp/results/enforce-output-budget.ts';

test('oversized output remains valid JSON and carries a truncation marker', () => {
  const output = enforceOutputBudget(JSON.stringify({ ok: true, revision: 4, summary: 'x'.repeat(5000), rows: [] }));
  expect(output.length).toBeLessThanOrEqual(MAX_TOOL_OUTPUT_LENGTH);
  expect(JSON.parse(output)).toMatchObject({ ok: true, revision: 4, truncated: true });
});
