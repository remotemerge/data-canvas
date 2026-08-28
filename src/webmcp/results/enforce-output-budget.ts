export const MAX_TOOL_OUTPUT_LENGTH = 1500;

export const enforceOutputBudget = (serialized: string): string => {
  if (serialized.length <= MAX_TOOL_OUTPUT_LENGTH) return serialized;

  try {
    const parsed = JSON.parse(serialized) as {
      ok?: unknown;
      revision?: unknown;
      summary?: unknown;
      code?: unknown;
      error?: unknown;
    };
    const compact = {
      ok: parsed.ok === true,
      ...(typeof parsed.revision === 'number' ? { revision: parsed.revision } : {}),
      ...(typeof parsed.code === 'string' ? { code: parsed.code } : {}),
      ...(typeof parsed.summary === 'string' ? { summary: parsed.summary.slice(0, 1200) } : {}),
      ...(typeof parsed.error === 'string' ? { error: parsed.error.slice(0, 1200) } : {}),
      truncated: true,
    };
    return JSON.stringify(compact).slice(0, MAX_TOOL_OUTPUT_LENGTH);
  } catch {
    return JSON.stringify({ ok: false, error: 'Tool output exceeded the disclosure limit.', truncated: true });
  }
};
