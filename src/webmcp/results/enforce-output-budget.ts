export const MAX_TOOL_OUTPUT_LENGTH = 1500;

/**
 * Marks a payload whose column list was explicitly requested by the caller.
 *
 * Such a projection is preserved when trimming: the agent named those columns, so dropping one forces
 * a second call for a field it already asked for, while fewer rows still answer the question. The key
 * is stripped before the response is returned.
 */
export const PRESERVE_COLUMNS_KEY = 'preserveColumns';

// Fields retained when trimming a payload.
const PRESERVED_LIST_KEYS = ['datasets'] as const;

// Result arrays trimmed from least to most important.
const TRIMMABLE_KEYS = [
  'columnIds',
  'columns',
  'rows',
  'filters',
  'selections',
  'relationships',
  'metrics',
  'annotations',
  'visualizations',
  'related',
] as const;

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
  // Set when the projection is narrowed, then appended to the summary once row trimming settles.
  let columnNotice: string | undefined;
  // Internal hint from the producing tool; it directs trimming and never reaches the agent.
  const preserveColumns = parsed[PRESERVE_COLUMNS_KEY] === true;
  for (const [key, value] of Object.entries(parsed)) {
    if (key === PRESERVE_COLUMNS_KEY) {
      continue;
    }
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
      result[key] = typeof value === 'string' ? value.slice(0, 1200) : value;
    }
  }

  const knownKeys = new Set<string>([...PRESERVED_LIST_KEYS, ...TRIMMABLE_KEYS]);
  const additionalListKeys = Object.keys(parsed).filter((key) => Array.isArray(parsed[key]) && !knownKeys.has(key));
  const orderedKeys = [...PRESERVED_LIST_KEYS, ...TRIMMABLE_KEYS, ...additionalListKeys];
  const lists = orderedKeys.flatMap((key) => (Array.isArray(parsed[key]) ? [[key, parsed[key]] as const] : []));
  for (const [key, value] of lists) {
    result[key] = key === 'rows' ? value.map((row) => (Array.isArray(row) ? [...row] : row)) : [...value];
  }

  const originalColumns = (parsed['columns'] ?? parsed['columnIds']) as unknown[] | undefined;
  const keptColumns = (result['columns'] ?? result['columnIds']) as unknown[] | undefined;
  const keptRows = result['rows'] as unknown[][] | undefined;
  const keptColumnIds = result['columnIds'] as unknown[] | undefined;
  const isColumnObjects = Array.isArray(result['columns']);
  const columnCountKey = isColumnObjects ? 'columns' : 'columnIds';

  if (Array.isArray(originalColumns) && Array.isArray(keptColumns) && Array.isArray(keptRows) && !preserveColumns) {
    const measured = (): number =>
      serializedLength({
        ...result,
        [`${columnCountKey}Returned`]: keptColumns.length,
        [`${columnCountKey}Total`]: result[`${columnCountKey}Total`] ?? originalColumns.length,
        truncated: true,
      });

    // Keep rows useful by narrowing a wide preview and trimming each row to the same projection.
    while (keptColumns.length > 1 && measured() > MAX_TOOL_OUTPUT_LENGTH) {
      keptColumns.pop();
      if (isColumnObjects && Array.isArray(keptColumnIds) && keptColumnIds.length > keptColumns.length) {
        keptColumnIds.pop();
      }
      for (const row of keptRows) {
        if (Array.isArray(row) && row.length > keptColumns.length) {
          row.length = keptColumns.length;
        }
      }
    }

    if (keptColumns.length < originalColumns.length) {
      result[`${columnCountKey}Returned`] = keptColumns.length;
      result[`${columnCountKey}Total`] ??= originalColumns.length;

      /*
       * State the dropped columns in the summary. An agent reading only that line would otherwise
       * treat a narrowed projection as the full one it requested. Applying it before the row-trim
       * loop keeps the longer summary inside the budget the loop enforces.
       */
      columnNotice = `Returned ${keptColumns.length} of ${originalColumns.length} requested columns.`;
      result['summary'] = typeof result['summary'] === 'string' ? `${result['summary']} ${columnNotice}` : columnNotice;
    }
  }

  // Trim trailing fields first so dataset identifiers remain available for follow-up tools.
  for (
    let index = lists.length - 1;
    index >= 0 && serializedLength({ ...result, truncated: true }) > MAX_TOOL_OUTPUT_LENGTH;
    index -= 1
  ) {
    const [key, original] = lists[index]!;
    if ((PRESERVED_LIST_KEYS as readonly string[]).includes(key)) {
      continue;
    }
    const kept = result[key] as unknown[];

    const originalTotal =
      typeof parsed[`${key}Total`] === 'number'
        ? (parsed[`${key}Total`] as number)
        : (result[`${key}Total`] ?? original.length);

    // Include trim counters in the size calculation before returning.
    const measured = (): number =>
      serializedLength({
        ...result,
        [`${key}Returned`]: kept.length,
        [`${key}Total`]: originalTotal,
        truncated: true,
      });
    while (kept.length > 0 && measured() > MAX_TOOL_OUTPUT_LENGTH) {
      kept.pop();
    }
    if (kept.length < original.length) {
      result[`${key}Returned`] = kept.length;
      result[`${key}Total`] = originalTotal;
      if (key === 'rows' && typeof originalTotal === 'number') {
        result['summary'] =
          `Returned ${kept.length} of ${originalTotal} rows.${columnNotice === undefined ? '' : ` ${columnNotice}`}`;
      }
    }
  }

  return { ...result, truncated: true };
};

// Removes the internal trimming hint from a payload that is returned as-is.
const withoutInternalKeys = (serialized: string): string => {
  if (!serialized.includes(`"${PRESERVE_COLUMNS_KEY}"`)) {
    return serialized;
  }

  try {
    const { [PRESERVE_COLUMNS_KEY]: _internal, ...rest } = JSON.parse(serialized) as ToolPayload;

    return JSON.stringify(rest);
  } catch {
    return serialized;
  }
};

/**
 * Last-resort payload for output whose scalar fields alone exceed the budget.
 *
 * The identity fields an agent branches on (`ok`, `revision`, `code`) are kept whole; only the free
 * text is shortened. Both text fields are capped together rather than individually, because two
 * separately capped strings can still exceed the budget once serialized. Truncating the finished JSON
 * instead would cut mid-string and hand the agent a payload it cannot parse.
 */
const scalarFallback = (parsed: ToolPayload): string => {
  const revision = typeof parsed.revision === 'number' ? { revision: parsed.revision } : {};
  const code = typeof parsed.code === 'string' ? { code: parsed.code } : {};
  const summary = typeof parsed.summary === 'string' ? parsed.summary : undefined;
  const error = typeof parsed.error === 'string' ? parsed.error : undefined;

  const build = (textBudget: number): string =>
    JSON.stringify({
      ok: parsed.ok === true,
      ...revision,
      ...code,
      ...(summary === undefined ? {} : { summary: summary.slice(0, textBudget) }),
      ...(error === undefined ? {} : { error: error.slice(0, textBudget) }),
      truncated: true,
    });

  let textBudget = 1200;
  let candidate = build(textBudget);

  // Shrink the text allowance until the serialized payload fits, so the result stays parsable JSON.
  while (candidate.length > MAX_TOOL_OUTPUT_LENGTH && textBudget > 0) {
    textBudget = Math.max(0, textBudget - Math.ceil((candidate.length - MAX_TOOL_OUTPUT_LENGTH) / 2));
    candidate = build(textBudget);
  }

  /*
   * The identity fields alone can still exceed the budget when a caller supplies an oversized `code`.
   * Dropping the text entirely is preferable to returning something that does not parse.
   */
  return candidate.length <= MAX_TOOL_OUTPUT_LENGTH
    ? candidate
    : JSON.stringify({ ok: parsed.ok === true, ...revision, truncated: true });
};

export const enforceOutputBudget = (serialized: string): string => {
  if (serialized.length <= MAX_TOOL_OUTPUT_LENGTH) {
    return withoutInternalKeys(serialized);
  }

  try {
    const parsed = JSON.parse(serialized) as ToolPayload;
    const trimmed = JSON.stringify({ ...trimToBudget(parsed), ok: parsed.ok === true });

    // Scalar fields alone exceed the budget, so return valid summary-only JSON.
    return trimmed.length <= MAX_TOOL_OUTPUT_LENGTH ? trimmed : scalarFallback(parsed);
  } catch {
    return JSON.stringify({ ok: false, error: 'Tool output exceeded the disclosure limit.', truncated: true });
  }
};
