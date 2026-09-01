import type { ModelContext } from '@mcp-b/webmcp-types';
import { domainError } from '@/shared/errors/domain-error.ts';
import type { DataCanvasTool, ToolDependencies } from '@/webmcp/registry/tool-types.ts';
import { setToolStatus } from '@/webmcp/registry/tool-status.ts';
import { toolValidators } from '@/webmcp/schemas/compile-schemas.ts';
import { enforceOutputBudget } from '@/webmcp/results/enforce-output-budget.ts';
import { failure } from '@/webmcp/tools/tool-helpers.ts';
import { createReadTools } from '@/webmcp/tools/read/read-tools.ts';
import { createWriteTools } from '@/webmcp/tools/write/write-tools.ts';

export const createToolDefinitions = (deps: ToolDependencies): DataCanvasTool[] => [
  ...createReadTools(deps),
  ...createWriteTools(deps),
];

export const executeTool = async (tool: DataCanvasTool, input: unknown): Promise<string> => {
  const validator = toolValidators[tool.name];
  if (!validator(input)) {
    return failure(domainError('INVALID_TOOL_ARGUMENTS', 'Arguments do not match this tool schema.'));
  }

  try {
    return enforceOutputBudget(await tool.handler(input));
  } catch {
    return failure(domainError('UNSUPPORTED_OPERATION', 'The tool could not complete the requested operation.'));
  }
};

export interface ToolRegistry {
  setDatasetToolsEnabled(enabled: boolean): Promise<void>;
  dispose(): void;
}

export const createToolRegistry = async (host: ModelContext, deps: ToolDependencies): Promise<ToolRegistry> => {
  const tools = createToolDefinitions(deps);
  const controllers = new Map<string, AbortController>();
  let executingCount = 0;

  const register = async (tool: DataCanvasTool): Promise<void> => {
    if (controllers.has(tool.name)) return;
    const controller = new AbortController();
    controllers.set(tool.name, controller);

    await host.registerTool(
      {
        name: tool.name,
        description: tool.description,
        inputSchema: tool.schema,
        annotations: tool.annotations,
        execute: async (input) => {
          executingCount += 1;
          setToolStatus({ executingCount });
          try {
            return await executeTool(tool, input);
          } finally {
            executingCount = Math.max(0, executingCount - 1);
            setToolStatus({ executingCount });
          }
        },
      },
      // Keep v1 tools same-origin; omit cross-origin exposure.
      { signal: controller.signal },
    );
    setToolStatus({ registeredCount: controllers.size });
  };

  const unregister = (tool: DataCanvasTool): void => {
    controllers.get(tool.name)?.abort();
    controllers.delete(tool.name);
    setToolStatus({ registeredCount: controllers.size });
  };

  await Promise.all(tools.filter((candidate) => !candidate.needsDataset).map(register));
  setToolStatus({ available: true });

  return {
    setDatasetToolsEnabled: async (enabled) => {
      const datasetTools = tools.filter((candidate) => candidate.needsDataset);
      if (enabled) await Promise.all(datasetTools.map(register));
      else for (const tool of datasetTools) unregister(tool);
    },
    dispose: () => {
      for (const controller of controllers.values()) controller.abort();
      controllers.clear();
      setToolStatus({ available: false, registeredCount: 0, executingCount: 0 });
    },
  };
};
