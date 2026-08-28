import { compileAggregate } from '@/data/compiler/compile-aggregate.ts';
import { compileFilterExpression } from '@/data/compiler/compile-filter-expression.ts';
import type { ResultColumn } from '@/data/compiler/result-columns.ts';
import { quoteIdentifier } from '@/data/duckdb/identifier-safety.ts';
import type { AnalysisQuery } from '@/domain/analysis/analysis-query.ts';
import type { Column, Dataset } from '@/domain/dataset/dataset.ts';
import { domainError } from '@/shared/errors/domain-error.ts';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import type { EntityId } from '@/shared/ids/entity-id.ts';
import { err, ok } from '@/shared/result/result.ts';
import type { Result } from '@/shared/result/result.ts';

export const DEFAULT_QUERY_LIMIT = 500;
export const MAX_QUERY_LIMIT = 500;

export interface CompiledQuery {
  sql: string;
  parameters: readonly unknown[];
  resultColumns: ResultColumn[];
}

export type QueryDataset = Pick<Dataset, 'id' | 'relationId' | 'columns'>;

const resolveColumn = (dataset: QueryDataset, columnId: EntityId): Result<Column, DomainError> => {
  const column = dataset.columns.find((candidate) => candidate.id === columnId);
  return column === undefined
    ? err(domainError('COLUMN_NOT_FOUND', 'The query references a column that does not exist.', { columnId }))
    : ok(column);
};

export const compileAnalysisQuery = (
  query: AnalysisQuery,
  dataset: QueryDataset,
): Result<CompiledQuery, DomainError> => {
  if (query.datasetId !== dataset.id) {
    return err(domainError('DATASET_NOT_FOUND', 'The query does not target the resolved dataset.'));
  }

  const select: string[] = [];
  const groupBy: string[] = [];
  const resultColumns: ResultColumn[] = [];

  for (const columnId of query.dimensions) {
    const resolved = resolveColumn(dataset, columnId);
    if (!resolved.ok) return resolved;
    const identifier = quoteIdentifier(resolved.value.physicalName);
    select.push(identifier);
    groupBy.push(identifier);
    resultColumns.push({ key: resolved.value.id, name: resolved.value.name, logicalType: resolved.value.logicalType });
  }

  const measureAliases = new Map<string, string>();
  for (const [index, measure] of query.measures.entries()) {
    const column = measure.columnId === undefined ? undefined : resolveColumn(dataset, measure.columnId);
    if (column !== undefined && !column.ok) return column;
    const aggregate = compileAggregate(measure.aggregate, column?.value);
    if (!aggregate.ok) return aggregate;
    const alias = `m${index}`;
    select.push(`${aggregate.value} AS ${quoteIdentifier(alias)}`);
    if (measure.alias !== undefined) measureAliases.set(measure.alias, alias);
    resultColumns.push({
      key: measure.alias ?? alias,
      name: measure.alias ?? measure.aggregate,
      logicalType: 'number',
    });
  }

  if (select.length === 0) {
    for (const column of dataset.columns) {
      select.push(quoteIdentifier(column.physicalName));
      resultColumns.push({ key: column.id, name: column.name, logicalType: column.logicalType });
    }
  }

  const parameters: unknown[] = [];
  const where: string[] = [];
  for (const filter of query.filters) {
    const compiled = compileFilterExpression(filter, dataset.columns);
    if (!compiled.ok) return compiled;
    where.push(`(${compiled.value.sql})`);
    parameters.push(...compiled.value.parameters);
  }

  const orderBy: string[] = [];
  for (const sort of query.orderBy ?? []) {
    if (sort.columnId !== undefined) {
      const column = resolveColumn(dataset, sort.columnId);
      if (!column.ok) return column;
      orderBy.push(`${quoteIdentifier(column.value.physicalName)} ${sort.direction.toUpperCase()}`);
    } else if (sort.measureAlias !== undefined && measureAliases.has(sort.measureAlias)) {
      orderBy.push(
        `${quoteIdentifier(measureAliases.get(sort.measureAlias) as string)} ${sort.direction.toUpperCase()}`,
      );
    } else {
      return err(domainError('COLUMN_NOT_FOUND', 'The query sort target does not exist.'));
    }
  }

  const requestedLimit = query.limit ?? DEFAULT_QUERY_LIMIT;
  const limit = Math.min(Math.max(Math.trunc(requestedLimit), 1), MAX_QUERY_LIMIT);
  const offset = Math.max(Math.trunc(query.offset ?? 0), 0);
  const sql = [
    `SELECT ${select.join(', ')} FROM ${quoteIdentifier(dataset.relationId)}`,
    where.length === 0 ? '' : `WHERE ${where.join(' AND ')}`,
    groupBy.length > 0 && query.measures.length > 0 ? `GROUP BY ${groupBy.join(', ')}` : '',
    orderBy.length === 0 ? '' : `ORDER BY ${orderBy.join(', ')}`,
    `LIMIT ${limit}`,
    offset === 0 ? '' : `OFFSET ${offset}`,
  ]
    .filter(Boolean)
    .join(' ');

  return ok({ sql, parameters, resultColumns });
};
