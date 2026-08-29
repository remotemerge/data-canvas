import { compileAggregate } from '@/data/compiler/compile-aggregate.ts';
import { compileFilterExpression } from '@/data/compiler/compile-filter-expression.ts';
import type { ColumnReferenceResolver } from '@/data/compiler/compile-filter-expression.ts';
import { datasetIdsForColumns, resolveJoinPath } from '@/data/compiler/resolve-join-path.ts';
import type { JoinPlan } from '@/data/compiler/resolve-join-path.ts';
import type { ResultColumn } from '@/data/compiler/result-columns.ts';
import { quoteIdentifier } from '@/data/duckdb/identifier-safety.ts';
import type { AnalysisQuery } from '@/domain/analysis/analysis-query.ts';
import type { Column, Dataset } from '@/domain/dataset/dataset.ts';
import type { Relationship } from '@/domain/relationship/relationship.ts';
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
  /** Datasets the query reads, anchor first. Single-element unless the query crosses a join. */
  datasetIds: EntityId[];
  /** True when the query joins at least one relationship, so callers can apply the fan-out check. */
  joined: boolean;
}

export type QueryDataset = Pick<Dataset, 'id' | 'relationId' | 'columns'>;

/**
 * Everything the compiler may read besides the query itself.
 *
 * A single dataset is still accepted directly, so the many callers that never cross a join stay
 * unchanged and cannot accidentally opt into join resolution.
 */
export interface QueryContext {
  datasets: readonly QueryDataset[];
  relationships?: readonly Relationship[];
}

/**
 * Deterministic table aliases.
 *
 * Generated from the join order, never derived from a dataset name, a filename, or agent input.
 * This is what keeps the join from introducing a new string-interpolation site: `t0`, `t1`, … always
 * satisfy the identifier allowlist, so `quoteIdentifier` can never reject or be bypassed here.
 */
export const joinAlias = (index: number): string => `t${index}`;

const missingColumn = (columnId: EntityId): DomainError =>
  domainError('COLUMN_NOT_FOUND', 'The query references a column that does not exist.', { columnId });

const normalizeContext = (context: QueryDataset | QueryContext): QueryContext =>
  'datasets' in context ? context : { datasets: [context] };

/**
 * Builds the reference resolver and the FROM/JOIN clause for a resolved plan.
 *
 * Both are produced together because they must agree on which alias belongs to which dataset; a
 * split would let a column reference name an alias the FROM clause never introduced.
 */
const buildFromClause = (
  plan: JoinPlan,
  datasets: readonly QueryDataset[],
): Result<{ sql: string; resolve: ColumnReferenceResolver }, DomainError> => {
  const aliases = new Map<EntityId, string>();

  for (const [index, datasetId] of plan.datasetIds.entries()) aliases.set(datasetId, joinAlias(index));

  const datasetFor = (datasetId: EntityId): QueryDataset | undefined =>
    datasets.find((candidate) => candidate.id === datasetId);

  const anchorId = plan.datasetIds[0] as EntityId;
  const anchor = datasetFor(anchorId);

  if (anchor === undefined) return err(domainError('DATASET_NOT_FOUND', 'The query anchor dataset was not resolved.'));

  // A single-dataset query keeps its historical unaliased shape. Aliasing it would change every
  // existing compiled statement for no gain, and the alias only earns its place once two relations
  // can contribute the same physical column name.
  const unjoined = plan.steps.length === 0;

  const referenceFor = (dataset: QueryDataset, column: Column): string =>
    unjoined
      ? quoteIdentifier(column.physicalName)
      : `${quoteIdentifier(aliases.get(dataset.id) as string)}.${quoteIdentifier(column.physicalName)}`;

  const resolve: ColumnReferenceResolver = (columnId) => {
    for (const datasetId of plan.datasetIds) {
      const dataset = datasetFor(datasetId);
      const column = dataset?.columns.find((candidate) => candidate.id === columnId);

      if (dataset !== undefined && column !== undefined) return { sql: referenceFor(dataset, column), column };
    }

    return undefined;
  };

  const fragments = [
    unjoined
      ? quoteIdentifier(anchor.relationId)
      : `${quoteIdentifier(anchor.relationId)} AS ${quoteIdentifier(joinAlias(0))}`,
  ];

  for (const step of plan.steps) {
    const joined = datasetFor(step.toDatasetId);

    if (joined === undefined) {
      return err(
        domainError('DATASET_NOT_FOUND', 'A joined dataset was not resolved.', { datasetId: step.toDatasetId }),
      );
    }

    const conditions: string[] = [];

    for (const pair of step.relationship.on) {
      const left = resolve(pair.leftColumnId);
      const right = resolve(pair.rightColumnId);

      if (left === undefined) return err(missingColumn(pair.leftColumnId));
      if (right === undefined) return err(missingColumn(pair.rightColumnId));

      conditions.push(`${left.sql} = ${right.sql}`);
    }

    if (conditions.length === 0) {
      return err(
        domainError('UNSUPPORTED_OPERATION', 'A relationship must declare at least one key column pair.', {
          relationshipId: step.relationship.id,
        }),
      );
    }

    // `LEFT` is emitted relative to the traversal direction rather than the stored left/right
    // fields: a left join preserves the rows already in the chain, which is the dataset the step
    // joins *from*, whichever side of the relationship that happens to be.
    const keyword = step.relationship.join === 'left' ? 'LEFT JOIN' : 'INNER JOIN';

    fragments.push(
      `${keyword} ${quoteIdentifier(joined.relationId)} AS ${quoteIdentifier(aliases.get(joined.id) as string)} ON ${conditions.join(' AND ')}`,
    );
  }

  return ok({ sql: fragments.join(' '), resolve });
};

/**
 * Compiles an `AnalysisQuery` to parameterized SQL.
 *
 * Every identifier is emitted through `quoteIdentifier` and every value is a bound parameter,
 * including across a join: relationship key columns become alias-qualified identifiers, and the
 * aliases themselves are generated from the join order rather than from any caller-supplied text.
 */
export const compileAnalysisQuery = (
  query: AnalysisQuery,
  context: QueryDataset | QueryContext,
): Result<CompiledQuery, DomainError> => {
  const { datasets, relationships = [] } = normalizeContext(context);
  const anchor = datasets.find((candidate) => candidate.id === query.datasetId);

  if (anchor === undefined) {
    return err(domainError('DATASET_NOT_FOUND', 'The query does not target the resolved dataset.'));
  }

  const referencedColumnIds = [
    ...query.dimensions,
    ...query.measures.flatMap((measure) => (measure.columnId === undefined ? [] : [measure.columnId])),
    ...(query.orderBy ?? []).flatMap((sort) => (sort.columnId === undefined ? [] : [sort.columnId])),
    ...query.filters.flatMap(collectFilterColumnIds),
  ];

  const plan = resolveJoinPath(
    anchor.id,
    datasetIdsForColumns(referencedColumnIds, datasets),
    relationships,
    query.relationshipIds,
  );

  if (!plan.ok) return plan;

  const from = buildFromClause(plan.value, datasets);

  if (!from.ok) return from;

  const { resolve } = from.value;

  const select: string[] = [];
  const groupBy: string[] = [];
  const resultColumns: ResultColumn[] = [];

  for (const columnId of query.dimensions) {
    const resolved = resolve(columnId);
    if (resolved === undefined) return err(missingColumn(columnId));
    select.push(resolved.sql);
    groupBy.push(resolved.sql);
    resultColumns.push({
      key: resolved.column.id,
      name: resolved.column.name,
      logicalType: resolved.column.logicalType,
    });
  }

  const measureAliases = new Map<string, string>();
  for (const [index, measure] of query.measures.entries()) {
    const resolved = measure.columnId === undefined ? undefined : resolve(measure.columnId);
    if (measure.columnId !== undefined && resolved === undefined) return err(missingColumn(measure.columnId));
    const aggregate = compileAggregate(measure.aggregate, resolved?.column, resolved?.sql);
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
    // A bare projection selects the anchor's own columns only. Widening it across a join would
    // return whatever the join happened to reach, which no caller asked for.
    for (const column of anchor.columns) {
      const resolved = resolve(column.id);
      if (resolved === undefined) return err(missingColumn(column.id));
      select.push(resolved.sql);
      resultColumns.push({ key: column.id, name: column.name, logicalType: column.logicalType });
    }
  }

  const parameters: unknown[] = [];
  const where: string[] = [];
  for (const filter of query.filters) {
    const compiled = compileFilterExpression(filter, resolve);
    if (!compiled.ok) return compiled;
    where.push(`(${compiled.value.sql})`);
    parameters.push(...compiled.value.parameters);
  }

  const orderBy: string[] = [];
  for (const sort of query.orderBy ?? []) {
    if (sort.columnId !== undefined) {
      const resolved = resolve(sort.columnId);
      if (resolved === undefined) return err(missingColumn(sort.columnId));
      orderBy.push(`${resolved.sql} ${sort.direction.toUpperCase()}`);
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
    `SELECT ${select.join(', ')} FROM ${from.value.sql}`,
    where.length === 0 ? '' : `WHERE ${where.join(' AND ')}`,
    groupBy.length > 0 && query.measures.length > 0 ? `GROUP BY ${groupBy.join(', ')}` : '',
    orderBy.length === 0 ? '' : `ORDER BY ${orderBy.join(', ')}`,
    `LIMIT ${limit}`,
    offset === 0 ? '' : `OFFSET ${offset}`,
  ]
    .filter(Boolean)
    .join(' ');

  return ok({
    sql,
    parameters,
    resultColumns,
    datasetIds: plan.value.datasetIds,
    joined: plan.value.steps.length > 0,
  });
};

/** Collects every column a filter tree names, so join resolution sees filtered columns too. */
function collectFilterColumnIds(expression: AnalysisQuery['filters'][number]): EntityId[] {
  if (expression.kind === 'comparison') return [expression.columnId];
  if (expression.kind === 'not') return collectFilterColumnIds(expression.operand);

  return expression.operands.flatMap(collectFilterColumnIds);
}
