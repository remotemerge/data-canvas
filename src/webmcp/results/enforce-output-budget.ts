export const MAX_TOOL_OUTPUT_LENGTH = 1500;

// Fields retained when trimming a payload.
const SCALAR_KEYS = new Set(['ok', 'revision', 'code', 'summary', 'error', 'datasetId', 'name', 'rowCount']);

// Result arrays trimmed from least to most important.
const TRIMMABLE_KEYS = ['columnIds', 'columns', 'visualizations', 'filters', 'related', 'rows'] as const;

interface ToolPayload {
  ok?: unknown;
  revision?: unknown;
  code?: unknown;
  summary?: unknown;
  error?: unknown;
  [key: string]: unknown;
}

const serializedLength = (value: object): number => JSON.stringify(value).length;

// Trims an oversized payload while preserving its shape.
const trimToBudget = (parsed: ToolPayload): Record<string, unknown> => {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (SCALAR_KEYS.has(key)) result[key] = typeof value === 'string' ? value.slice(0, 1200) : value;
  }

  const lists = TRIMMABLE_KEYS.flatMap((key) => (Array.isArray(parsed[key]) ? [[key, parsed[key]] as const] : []));
  for (const [key, value] of lists) result[key] = [...value];

  // Trim trailing fields first so earlier fields keep their entries.
  for (
    let index = lists.length - 1;
    index >= 0 && serializedLength({ ...result, truncated: true }) > MAX_TOOL_OUTPUT_LENGTH;
    index -= 1
  ) {
    const [key, original] = lists[index]!;
    const kept = result[key] as unknown[];

    // Include trim counters in the size calculation before returning.
    const measured = (): number =>
      serializedLength({
        ...result,
        [`${key}Returned`]: original.length,
        [`${key}Total`]: original.length,
        truncated: true,
      });
    while (kept.length > 0 && measured() > MAX_TOOL_OUTPUT_LENGTH) kept.pop();
    if (kept.length < original.length) {
      result[`${key}Returned`] = kept.length;
      result[`${key}Total`] = original.length;
    }
  }

  return { ...result, truncated: true };
};

export const enforceOutputBudget = (serialized: string): string => {
  if (serialized.length <= MAX_TOOL_OUTPUT_LENGTH) return serialized;

  try {
    const parsed = JSON.parse(serialized) as ToolPayload;
    const trimmed = JSON.stringify({ ...trimToBudget(parsed), ok: parsed.ok === true });

    // Scalar fields alone exceed the budget, so return valid summary-only JSON.
    return trimmed.length <= MAX_TOOL_OUTPUT_LENGTH
      ? trimmed
      : JSON.stringify({
          ok: parsed.ok === true,
          ...(typeof parsed.revision === 'number' ? { revision: parsed.revision } : {}),
          ...(typeof parsed.code === 'string' ? { code: parsed.code } : {}),
          ...(typeof parsed.summary === 'string' ? { summary: parsed.summary.slice(0, 1200) } : {}),
          ...(typeof parsed.error === 'string' ? { error: parsed.error.slice(0, 1200) } : {}),
          truncated: true,
        }).slice(0, MAX_TOOL_OUTPUT_LENGTH);
  } catch {
    return JSON.stringify({ ok: false, error: 'Tool output exceeded the disclosure limit.', truncated: true });
  }
};
