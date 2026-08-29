import type { DomainError } from '@/shared/errors/domain-error.ts';
import { domainError } from '@/shared/errors/domain-error.ts';
import { enforceOutputBudget } from '@/webmcp/results/enforce-output-budget.ts';
import { mapDomainError } from '@/webmcp/errors/map-domain-error.ts';
import { successResult } from '@/webmcp/results/tool-result.ts';

export interface ToolInput {
  datasetId?: unknown;
  columnId?: unknown;
  columnIds?: unknown;
  includeRelated?: unknown;
  leftDatasetId?: unknown;
  rightDatasetId?: unknown;
  on?: unknown;
  join?: unknown;
  relationshipIds?: unknown;
  includeSuggestions?: unknown;
  dimensions?: unknown;
  measures?: unknown;
  limit?: unknown;
  visualizationId?: unknown;
  title?: unknown;
  kind?: unknown;
  xColumnId?: unknown;
  yColumnIds?: unknown;
  groupByColumnId?: unknown;
  aggregate?: unknown;
  operator?: unknown;
  value?: unknown;
  values?: unknown;
  name?: unknown;
  filterIds?: unknown;
  text?: unknown;
  anchor?: unknown;
  expression?: unknown;
  modifier?: unknown;
  binX?: unknown;
  binSeries?: unknown;
  topValueLimit?: unknown;
  linkMode?: unknown;
  additive?: unknown;
  expectedRevision?: unknown;
}

export const asInput = (input: unknown): ToolInput => input as ToolInput;

export const failure = (error: DomainError): string => enforceOutputBudget(mapDomainError(error));

export const invalidEntity = (
  code: 'DATASET_NOT_FOUND' | 'COLUMN_NOT_FOUND' | 'VISUALIZATION_NOT_FOUND',
  message: string,
): string => failure(domainError(code, message));

export const success = (result: { revision: number; summary: string; [key: string]: unknown }): string =>
  enforceOutputBudget(successResult(result));

export const boundedCell = (value: string | number | boolean | null): string | number | boolean | null =>
  typeof value === 'string' ? value.slice(0, 200) : value;
