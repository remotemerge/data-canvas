import { describe, expect, test } from 'bun:test';
import boundedReadTools from './scenarios/bounded-read-tools.json';
import filterToWest from './scenarios/filter-to-west.json';
import monthlyRevenue from './scenarios/monthly-revenue.json';
import preserveChart from './scenarios/preserve-revenue-chart.json';
import removeEurope from './scenarios/remove-europe.json';
import timeSeries from './scenarios/time-series-columns.json';
import { runScenario, type EvalScenario } from './harness.ts';

describe('recorded agent transcripts', () => {
  test.each([
    monthlyRevenue,
    removeEurope,
    preserveChart,
    timeSeries,
    filterToWest,
    boundedReadTools,
  ] as EvalScenario[])('$name', async (scenario) => {
    const result = await runScenario(scenario);
    expect(result.scores).toEqual({
      correctToolsSelected: true,
      correctArguments: true,
      unnecessaryToolsAvoided: true,
      existingHumanChangesPreserved: true,
      workspaceResultCorrect: true,
      toolOutputStayedBounded: true,
    });
  });
});
