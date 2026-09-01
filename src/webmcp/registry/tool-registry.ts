import type { ErrorObject } from 'ajv';
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

/*
 * Ajv keeps the useful part of a rejection in `params` rather than in `message`: which property was
 * unknown, and which values an enum accepts. An agent that cannot read tool descriptors has to
 * rediscover a contract from these messages, so name the offending field instead of leaving it to
 * be guessed one probe call at a time.
 */
const describeValidationError = (error: ErrorObject): string => {
  const location = error.instancePath === '' ? '/' : error.instancePath;
  const params = error.params as { additionalProperty?: string; allowedValues?: unknown[]; allowedValue?: unknown };
  const message = error.message ?? 'is invalid';

  if (error.keyword === 'additionalProperties' && typeof params.additionalProperty === 'string') {
    return `'${location}' has unknown property '${params.additionalProperty}'.`;
  }

  if (error.keyword === 'enum' && Array.isArray(params.allowedValues)) {
    return `'${location}' ${message}: ${params.allowedValues.map((value) => JSON.stringify(value)).join(', ')}.`;
  }

  if (error.keyword === 'const' && 'allowedValue' in params) {
    return `'${location}' must be equal to ${JSON.stringify(params.allowedValue)}.`;
  }

  return `'${location}' ${message}.`;
};

export const executeTool = async (tool: DataCanvasTool, input: unknown): Promise<string> => {
  const validator = toolValidators[tool.name];
  if (!validator(input)) {
    const first = validator.errors?.[0];
    const detail = first === undefined ? 'Arguments do not match this tool schema.' : describeValidationError(first);
    return failure(domainError('INVALID_TOOL_ARGUMENTS', detail));
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
