import { describe, expect, test } from 'bun:test';
import { gradeTranscript } from './expected-call.ts';
import type { ExpectedCallNode } from './expected-call.ts';

const call = (tool: string, args: Record<string, unknown> = {}) => ({ tool, arguments: args });

describe('gradeTranscript', () => {
  test('accepts a transcript that matches an ordered expectation', () => {
    const expected: ExpectedCallNode[] = [{ functionName: 'preview_data' }, { functionName: 'analyze_data' }];

    const graded = gradeTranscript(expected, [call('preview_data'), call('analyze_data')]);

    expect(graded.satisfied).toBe(true);
    expect(graded.noExtraCalls).toBe(true);
  });

  // The previous scorer compared the recorded list against itself, so a wrong tool still passed.
  test('rejects a transcript that calls the wrong tool', () => {
    const expected: ExpectedCallNode[] = [{ functionName: 'create_visualization' }];

    const graded = gradeTranscript(expected, [call('analyze_data')]);

    expect(graded.satisfied).toBe(false);
    expect(graded.grades[0]?.detail).toContain("expected 'create_visualization'");
  });

  test('rejects a transcript that stops short of the expectation', () => {
    const expected: ExpectedCallNode[] = [{ functionName: 'apply_filter' }, { functionName: 'highlight_selection' }];

    expect(gradeTranscript(expected, [call('apply_filter')]).satisfied).toBe(false);
  });

  test('reports an extra call beyond the expectation', () => {
    const expected: ExpectedCallNode[] = [{ functionName: 'preview_data' }];

    const graded = gradeTranscript(expected, [call('preview_data'), call('analyze_data')]);

    expect(graded.satisfied).toBe(true);
    expect(graded.noExtraCalls).toBe(false);
  });

  test('an ordered expectation rejects the reversed sequence', () => {
    const expected: ExpectedCallNode[] = [
      { ordered: [{ functionName: 'apply_filter' }, { functionName: 'highlight_selection' }] },
    ];

    expect(gradeTranscript(expected, [call('highlight_selection'), call('apply_filter')]).satisfied).toBe(false);
  });

  test('an unordered expectation accepts either branch order', () => {
    const expected: ExpectedCallNode[] = [
      { unordered: [{ functionName: 'get_dataset_schema' }, { functionName: 'get_column_statistics' }] },
    ];

    const forward = gradeTranscript(expected, [call('get_dataset_schema'), call('get_column_statistics')]);
    const reverse = gradeTranscript(expected, [call('get_column_statistics'), call('get_dataset_schema')]);

    expect(forward.satisfied).toBe(true);
    expect(reverse.satisfied).toBe(true);
  });

  test('an unordered expectation still requires every branch', () => {
    const expected: ExpectedCallNode[] = [
      { unordered: [{ functionName: 'get_dataset_schema' }, { functionName: 'get_column_statistics' }] },
    ];

    expect(gradeTranscript(expected, [call('get_dataset_schema'), call('preview_data')]).satisfied).toBe(false);
  });

  test('nested ordering inside an unordered branch is enforced', () => {
    const expected: ExpectedCallNode[] = [
      {
        unordered: [
          { ordered: [{ functionName: 'apply_filter' }, { functionName: 'analyze_data' }] },
          { functionName: 'preview_data' },
        ],
      },
    ];

    const valid = gradeTranscript(expected, [call('preview_data'), call('apply_filter'), call('analyze_data')]);
    const invalid = gradeTranscript(expected, [call('analyze_data'), call('apply_filter'), call('preview_data')]);

    expect(valid.satisfied).toBe(true);
    expect(invalid.satisfied).toBe(false);
  });

  describe('argument grading', () => {
    test('accepts arguments that carry the asserted fields', () => {
      const expected: ExpectedCallNode[] = [
        { functionName: 'create_visualization', arguments: { kind: 'line', datasetId: 'ds_sales' } },
      ];

      const graded = gradeTranscript(expected, [
        call('create_visualization', { datasetId: 'ds_sales', kind: 'line', title: 'Revenue', expectedRevision: 0 }),
      ]);

      expect(graded.argumentsMatched).toBe(true);
    });

    // The failure the guide names: right tool, wrong parameter extracted from the prompt.
    test('rejects the right tool called with a wrong argument', () => {
      const expected: ExpectedCallNode[] = [{ functionName: 'create_visualization', arguments: { kind: 'line' } }];

      const graded = gradeTranscript(expected, [call('create_visualization', { kind: 'bar' })]);

      expect(graded.satisfied).toBe(true);
      expect(graded.argumentsMatched).toBe(false);
    });

    test('rejects an argument the call omits entirely', () => {
      const expected: ExpectedCallNode[] = [{ functionName: 'apply_filter', arguments: { operator: 'neq' } }];

      expect(gradeTranscript(expected, [call('apply_filter', { columnId: 'col_region' })]).argumentsMatched).toBe(
        false,
      );
    });

    test('compares nested and array arguments by value', () => {
      const expected: ExpectedCallNode[] = [
        { functionName: 'analyze_data', arguments: { measures: [{ aggregate: 'sum', columnId: 'col_revenue' }] } },
      ];

      const match = gradeTranscript(expected, [
        call('analyze_data', { measures: [{ aggregate: 'sum', columnId: 'col_revenue' }] }),
      ]);
      const mismatch = gradeTranscript(expected, [call('analyze_data', { measures: [{ aggregate: 'avg' }] })]);

      expect(match.argumentsMatched).toBe(true);
      expect(mismatch.argumentsMatched).toBe(false);
    });
  });
});
