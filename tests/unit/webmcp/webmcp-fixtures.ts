import { createUndoRedo } from '@/application/history/undo-redo.ts';
import type { DataEnginePort } from '@/application/ports/data-engine-port.ts';
import type { Workspace } from '@/domain/workspace/workspace.ts';
import { createToolDefinitions } from '@/webmcp/registry/tool-registry.ts';
import type { DataCanvasTool, ToolDependencies } from '@/webmcp/registry/tool-types.ts';
import {
  createHarness,
  stubColumnStatistics,
  stubDataEngine,
  workspaceWithDataset,
} from '../application/action-fixtures.ts';
import type { TestHarness } from '../application/action-fixtures.ts';

export interface WebmcpFixture {
  harness: TestHarness;
  deps: ToolDependencies;
  tools: DataCanvasTool[];
  tool: (name: string) => DataCanvasTool;
}

// Wires the WebMCP tool dependencies over a dispatcher harness so tool tests share one setup.
export const webmcpFixture = (
  workspace: Workspace = workspaceWithDataset(),
  engine: DataEnginePort = stubDataEngine(),
): WebmcpFixture => {
  const harness = createHarness(workspace, engine);
  const deps: ToolDependencies = {
    dispatcher: harness.dispatcher,
    history: createUndoRedo({ dispatcher: harness.dispatcher, store: harness.store }),
    getWorkspace: harness.workspace,
    fetchTableWindow: (request) => engine.fetchTableWindow(request),
    executeAnalysis: (query) => engine.executeAnalysis(query),
    fetchColumnStatistics: stubColumnStatistics(engine, harness.workspace),
  };
  const tools = createToolDefinitions(deps);
  const tool = (name: string): DataCanvasTool => {
    const found = tools.find((candidate) => candidate.name === name);
    if (found === undefined) {
      throw new Error(`Missing fixture tool '${name}'.`);
    }
    return found;
  };

  return { harness, deps, tools, tool };
};
