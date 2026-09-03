import {
  createHarness,
  stubColumnStatistics,
  stubDataEngine,
  visualization,
  workspaceWithDataset,
} from '../unit/application/action-fixtures.ts';
import { createToolDefinitions } from '@/webmcp/registry/tool-registry.ts';
import { MAX_TOOL_OUTPUT_LENGTH } from '@/webmcp/results/enforce-output-budget.ts';
import { gradeTranscript } from './expected-call.ts';
import type { ActualToolCall, ExpectedCallNode } from './expected-call.ts';

export interface EvalScenario {
  name: string;
  prompt: string;
  fixture: 'sales' | 'sales-with-chart';
  transcript: ActualToolCall[];
  expected: {
    // `tools` is the flat form of the same assertion, kept so scenarios needing no ordering nuance
    // stay a plain list of names.
    expectedCall?: ExpectedCallNode[];
    tools?: string[];
    visualizations?: number;
    filters?: number;
    selections?: number;
    preserveExisting?: boolean;
  };
}

const expectationNodes = (expected: EvalScenario['expected']): ExpectedCallNode[] =>
  expected.expectedCall ?? (expected.tools ?? []).map((functionName) => ({ functionName }));

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
    if (tool === undefined) {
      throw new Error(`Unknown recorded tool '${call.tool}'.`);
    }
    // Transcript calls are ordered because each expectedRevision observes the preceding call.
    // eslint-disable-next-line no-await-in-loop
    outputs.push(await tool.handler(call.arguments));
  }
  const final = harness.workspace();
  const graded = gradeTranscript(expectationNodes(scenario.expected), scenario.transcript);
  const workspaceCorrect =
    (scenario.expected.visualizations === undefined ||
      Object.keys(final.visualizations).length === scenario.expected.visualizations) &&
    (scenario.expected.filters === undefined || Object.keys(final.filters).length === scenario.expected.filters) &&
    (scenario.expected.selections === undefined ||
      Object.keys(final.selections).length === scenario.expected.selections);

  return {
    scores: {
      correctToolsSelected: graded.satisfied,
      correctArguments:
        graded.argumentsMatched && outputs.every((output) => !output.includes('INVALID_TOOL_ARGUMENTS')),
      unnecessaryToolsAvoided: graded.noExtraCalls,
      existingHumanChangesPreserved:
        !scenario.expected.preserveExisting || final.visualizations[existing.id] !== undefined,
      workspaceResultCorrect: workspaceCorrect,
      // The transport enforces this budget, so a scenario must fail here before a real agent is truncated.
      toolOutputStayedBounded: outputs.every((output) => output.length <= MAX_TOOL_OUTPUT_LENGTH),
    },
    grades: graded.grades,
    outputs,
    workspace: final,
  };
};
