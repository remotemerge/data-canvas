/*
 * A transcript is graded against a tree rather than a flat list because tool order is only partly
 * meaningful: reading two datasets before charting them is order-independent, while reading a
 * dataset before filtering it is not. `ordered` and `unordered` nodes let a scenario state which of
 * the two it means, so a run is not failed for a permutation that was always acceptable.
 */

export interface ExpectedToolCall {
  functionName: string;
  arguments?: Record<string, unknown>;
}

export interface OrderedExpectation {
  ordered: ExpectedCallNode[];
}

export interface UnorderedExpectation {
  unordered: ExpectedCallNode[];
}

export type ExpectedCallNode = ExpectedToolCall | OrderedExpectation | UnorderedExpectation;

export interface ActualToolCall {
  tool: string;
  arguments: Record<string, unknown>;
}

export interface CallGrade {
  toolSelected: boolean;
  argumentsMatched: boolean;
  detail?: string;
}

const isOrdered = (node: ExpectedCallNode): node is OrderedExpectation => 'ordered' in node;
const isUnordered = (node: ExpectedCallNode): node is UnorderedExpectation => 'unordered' in node;

export const expectedCallCount = (nodes: ExpectedCallNode[]): number =>
  nodes.reduce((total, node) => {
    if (isOrdered(node)) {
      return total + expectedCallCount(node.ordered);
    }
    if (isUnordered(node)) {
      return total + expectedCallCount(node.unordered);
    }

    return total + 1;
  }, 0);

// Extra actual keys are ignored so a scenario asserts the arguments carrying the prompt's intent,
// not the optional ones a caller may legitimately add.
const matchesSubset = (expected: unknown, actual: unknown): boolean => {
  if (Array.isArray(expected)) {
    return (
      Array.isArray(actual) &&
      expected.length === actual.length &&
      expected.every((item, index) => matchesSubset(item, actual[index]))
    );
  }

  if (expected !== null && typeof expected === 'object') {
    if (actual === null || typeof actual !== 'object' || Array.isArray(actual)) {
      return false;
    }
    const actualRecord = actual as Record<string, unknown>;

    return Object.entries(expected as Record<string, unknown>).every(
      ([key, value]) => key in actualRecord && matchesSubset(value, actualRecord[key]),
    );
  }

  return Object.is(expected, actual);
};

// An unordered node keeps the first branch that consumes cleanly. Branches are few and short, so
// this search costs less than the bookkeeping an index-based matcher would need.
const consume = (
  nodes: ExpectedCallNode[],
  actual: ActualToolCall[],
  start: number,
  grades: CallGrade[],
): number | null => {
  let cursor = start;

  for (const node of nodes) {
    if (isOrdered(node)) {
      const next = consume(node.ordered, actual, cursor, grades);
      if (next === null) {
        return null;
      }
      cursor = next;
      continue;
    }

    if (isUnordered(node)) {
      const remaining = [...node.unordered];
      while (remaining.length > 0) {
        const attempt = remaining.findIndex((branch) => consume([branch], actual, cursor, []) !== null);
        if (attempt === -1) {
          return null;
        }
        const [branch] = remaining.splice(attempt, 1);
        const next = consume([branch!], actual, cursor, grades);
        if (next === null) {
          return null;
        }
        cursor = next;
      }
      continue;
    }

    const call = actual[cursor];
    if (call === undefined) {
      return null;
    }

    const toolSelected = call.tool === node.functionName;
    const argumentsMatched =
      toolSelected && (node.arguments === undefined || matchesSubset(node.arguments, call.arguments));

    grades.push({
      toolSelected,
      argumentsMatched,
      ...(toolSelected ? {} : { detail: `expected '${node.functionName}', called '${call.tool}'` }),
    });

    if (!toolSelected) {
      return null;
    }
    cursor += 1;
  }

  return cursor;
};

export interface ExpectationResult {
  // Every expected call matched, in an order the tree permits.
  satisfied: boolean;
  noExtraCalls: boolean;
  argumentsMatched: boolean;
  grades: CallGrade[];
}

export const gradeTranscript = (expected: ExpectedCallNode[], actual: ActualToolCall[]): ExpectationResult => {
  const grades: CallGrade[] = [];
  const consumed = consume(expected, actual, 0, grades);
  const satisfied = consumed !== null && grades.length === expectedCallCount(expected);

  return {
    satisfied,
    noExtraCalls: consumed !== null && consumed === actual.length,
    argumentsMatched: satisfied && grades.every((grade) => grade.argumentsMatched),
    grades,
  };
};
