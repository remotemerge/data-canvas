import {
  createHarness,
  stubColumnStatistics,
  stubDataEngine,
  visualization,
  workspaceWithDataset,
} from '../unit/application/action-fixtures.ts';
import { createToolDefinitions } from '@/webmcp/registry/tool-registry.ts';

export interface EvalScenario {
  name: string;
  prompt: string;
  fixture: 'sales' | 'sales-with-chart';
  transcript: { tool: string; arguments: Record<string, unknown> }[];
  expected: {
    tools: string[];
    visualizations?: number;
    filters?: number;
    selections?: number;
    preserveExisting?: boolean;
  };
}

export const runScenario = async (scenario: EvalScenario) => {
  const initial = workspaceWithDataset();
  const existing = visualization('viz_existing', 'ds_sales');
  const workspace =
    scenario.fixture === 'sales-with-chart' ? { ...initial, visualizations: { [existing.id]: existing } } : initial;
  const engine = stubDataEngine();
  const harness = createHarness(workspace, engine);
  const tools = createToolDefinitions({
    dispatcher: harness.dispatcher,
    getWorkspace: harness.workspace,
    fetchTableWindow: () =>
      Promise.resolve({
        ok: true,
        value: { rows: [], columns: [], columnIds: [], totalRowCount: 0, offset: 0, stale: false },
      }),
    executeAnalysis: () => Promise.resolve({ ok: true, value: { rows: [], columns: [] } }),
    fetchColumnStatistics: stubColumnStatistics(engine, harness.workspace),
  });
  const outputs: string[] = [];
  for (const call of scenario.transcript) {
    const tool = tools.find((candidate) => candidate.name === call.tool);
    if (tool === undefined) throw new Error(`Unknown recorded tool '${call.tool}'.`);
    // Transcript calls are ordered because each expectedRevision observes the preceding call.
    // eslint-disable-next-line no-await-in-loop
    outputs.push(await tool.handler(call.arguments));
  }
  const final = harness.workspace();
  const selected = scenario.transcript.map((call) => call.tool);
  const workspaceCorrect =
    (scenario.expected.visualizations === undefined ||
      Object.keys(final.visualizations).length === scenario.expected.visualizations) &&
    (scenario.expected.filters === undefined || Object.keys(final.filters).length === scenario.expected.filters) &&
    (scenario.expected.selections === undefined ||
      Object.keys(final.selections).length === scenario.expected.selections);
  return {
    scores: {
      correctToolsSelected: selected.every((name, index) => name === scenario.expected.tools[index]),
      correctArguments: outputs.every((output) => !output.includes('INVALID_TOOL_ARGUMENTS')),
      unnecessaryToolsAvoided: selected.length === scenario.expected.tools.length,
      existingHumanChangesPreserved:
        !scenario.expected.preserveExisting || final.visualizations[existing.id] !== undefined,
      workspaceResultCorrect: workspaceCorrect,
      toolOutputStayedBounded: outputs.every((output) => output.length <= 16_000),
    },
    outputs,
    workspace: final,
  };
};
