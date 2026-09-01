import type { ChromeModelContext, ModelContext, RegisteredTool } from '@mcp-b/webmcp-types';

export const resolveModelContextHost = (): ModelContext | null =>
  document.modelContext ?? navigator.modelContext ?? null;

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
