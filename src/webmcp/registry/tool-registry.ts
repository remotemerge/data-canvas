import type { ErrorObject } from 'ajv';
import type { ModelContext } from '@mcp-b/webmcp-types';
import { domainError } from '@/shared/errors/domain-error.ts';
import { requiredDatasetCount } from '@/webmcp/registry/tool-types.ts';
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

// Reads the signal at each check around an `await`; it may change between checks.
const isAborted = (signal: AbortSignal | undefined): boolean => signal?.aborted ?? false;

export const executeTool = async (tool: DataCanvasTool, input: unknown, signal?: AbortSignal): Promise<string> => {
  const validator = toolValidators[tool.name];
  if (!validator(input)) {
    const first = validator.errors?.[0];
    const detail = first === undefined ? 'Arguments do not match this tool schema.' : describeValidationError(first);
    return failure(domainError('INVALID_TOOL_ARGUMENTS', detail));
  }

  if (isAborted(signal)) {
    return failure(domainError('UNSUPPORTED_OPERATION', 'The tool call was cancelled before it ran.'));
  }

  try {
    return enforceOutputBudget(await tool.handler(input, signal));
  } catch {
    // Cancellation surfaces as a rejection; reporting it as a failure would invite a pointless retry.
    if (isAborted(signal)) {
      return failure(domainError('UNSUPPORTED_OPERATION', 'The tool call was cancelled before it completed.'));
    }
    return failure(domainError('UNSUPPORTED_OPERATION', 'The tool could not complete the requested operation.'));
  }
};

export interface ToolRegistry {
  setReadyDatasetCount(count: number): Promise<void>;
  dispose(): void;
}

export const createToolRegistry = async (host: ModelContext, deps: ToolDependencies): Promise<ToolRegistry> => {
  const tools = createToolDefinitions(deps);
  const controllers = new Map<string, AbortController>();
  let executingCount = 0;

  // Publishes the registered descriptors so the UI can show the same contract the agent host sees.
  const publishRegistered = (): void => {
    const registered = tools.filter((tool) => controllers.has(tool.name));

    setToolStatus({
      registeredCount: controllers.size,
      tools: registered.map((tool) => ({
        name: tool.name,
        title: tool.title,
        description: tool.description,
        annotations: { ...tool.annotations },
        inputSchema: tool.schema,
      })),
    });
  };

  const register = async (tool: DataCanvasTool): Promise<void> => {
    if (controllers.has(tool.name)) {
      return;
    }
    const controller = new AbortController();
    controllers.set(tool.name, controller);

    await host.registerTool(
      {
        name: tool.name,
        title: tool.title,
        description: tool.description,
        inputSchema: tool.schema,
        annotations: tool.annotations,
        // `@mcp-b/webmcp-types` types `execute` with the input alone, so the host's cancellation
        // argument is read positionally and treated as absent where it is not supplied.
        execute: async (input, ...rest: unknown[]) => {
          const signal = (rest[0] as { signal?: AbortSignal } | undefined)?.signal;
          executingCount += 1;
          setToolStatus({ executingCount });
          try {
            return await executeTool(tool, input, signal);
          } finally {
            executingCount = Math.max(0, executingCount - 1);
            setToolStatus({ executingCount });
          }
        },
      },
      // Keep v1 tools same-origin; omit cross-origin exposure.
      { signal: controller.signal },
    );
    publishRegistered();
  };

  const unregister = (tool: DataCanvasTool): void => {
    controllers.get(tool.name)?.abort();
    controllers.delete(tool.name);
    publishRegistered();
  };

  await Promise.all(tools.filter((candidate) => requiredDatasetCount(candidate) === 0).map(register));
  setToolStatus({ available: true });

  return {
    // Registration follows the ready-dataset count, so a tool appears only once it can succeed.
    setReadyDatasetCount: async (count) => {
      const satisfied = tools.filter(
        (candidate) => requiredDatasetCount(candidate) > 0 && requiredDatasetCount(candidate) <= count,
      );
      const unsatisfied = tools.filter((candidate) => requiredDatasetCount(candidate) > count);

      for (const tool of unsatisfied) {
        unregister(tool);
      }
      await Promise.all(satisfied.map(register));
    },
    dispose: () => {
      for (const controller of controllers.values()) {
        controller.abort();
      }
      controllers.clear();
      setToolStatus({ available: false, registeredCount: 0, executingCount: 0, tools: [] });
    },
  };
};
