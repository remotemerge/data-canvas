export const MAX_TOOL_OUTPUT_LENGTH = 1500;

/** Kept whole when a payload is trimmed: they identify the result rather than carry its bulk. */
const SCALAR_KEYS = new Set(['ok', 'revision', 'code', 'summary', 'error', 'datasetId', 'name', 'rowCount']);

/**
 * The array fields that carry a result's bulk, in increasing order of importance.
 *
 * Entries are dropped from the end of this list backwards, so `rows` — the bulkiest and the least
 * useful without its header — is sacrificed before `columns` and `columnIds`, which name the
 * identifiers the analysis tools require.
 */
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

/**
 * Shrinks an oversized payload without changing its shape.
 *
 * Dropping every field but `summary` — the previous behaviour — made `get_dataset_schema` unusable
 * on an ordinary 21-column dataset: the column list was the whole point of the call, and the
 * analysis tools take column *IDs*, so an agent that could not read them could not go on to query
 * anything. Entries are removed from the longest list until the payload fits, and each trimmed field
 * reports how many of its entries survived so the agent can page for the rest or narrow its request.
 */
const trimToBudget = (parsed: ToolPayload): Record<string, unknown> => {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (SCALAR_KEYS.has(key)) result[key] = typeof value === 'string' ? value.slice(0, 1200) : value;
  }

  const lists = TRIMMABLE_KEYS.flatMap((key) => (Array.isArray(parsed[key]) ? [[key, parsed[key]] as const] : []));
  for (const [key, value] of lists) result[key] = [...value];

  // Trailing fields are sacrificed first so the most useful ones keep their entries the longest.
  for (
    let index = lists.length - 1;
    index >= 0 && serializedLength({ ...result, truncated: true }) > MAX_TOOL_OUTPUT_LENGTH;
    index -= 1
  ) {
    const [key, original] = lists[index]!;
    const kept = result[key] as unknown[];

    // The counters are themselves part of the payload, so their cost is measured while trimming
    // rather than added afterwards — appending them later would push a just-fitting result back
    // over budget. `kept` is the live array, so each pop shrinks the measured size.
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

    // A payload whose scalar fields alone exceed the budget cannot be trimmed structurally; a hard
    // slice would emit invalid JSON, so it degrades to the summary-only form instead.
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
