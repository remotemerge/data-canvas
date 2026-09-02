import type { ChromeModelContext, ModelContext, RegisteredTool } from '@mcp-b/webmcp-types';

/*
 * `document.modelContext` is the standard surface. The deprecated `navigator.modelContext` is kept
 * as a fallback because browsers that shipped the earlier placement still expose only that one.
 */
export const resolveModelContextHost = (): ModelContext | null =>
  document.modelContext ?? navigator.modelContext ?? null; // NOSONAR

export const asChromeHost = (host: ModelContext): ChromeModelContext => host as ChromeModelContext;

export const readInputSchema = (tool: RegisteredTool): object | null => {
  const schema = tool.inputSchema;
  if (!schema) {
    return null;
  }
  if (typeof schema !== 'string') {
    return schema;
  }

  try {
    const parsed: unknown = JSON.parse(schema);
    return typeof parsed === 'object' && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
};
