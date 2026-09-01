import { compileAggregate } from '@/data/compiler/compile-aggregate.ts';
import { compileBinStrategy } from '@/data/compiler/compile-bin-strategy.ts';
import { compileDerivedExpression } from '@/data/compiler/compile-derived-expression.ts';
import { compileFilterExpression } from '@/data/compiler/compile-filter-expression.ts';
import type { ColumnReferenceResolver } from '@/data/compiler/compile-filter-expression.ts';
import { compileMetricModifier } from '@/data/compiler/compile-metric-modifier.ts';
import { compileTimeSpine } from '@/data/compiler/compile-time-spine.ts';
import { datasetIdsForColumns, resolveJoinPath } from '@/data/compiler/resolve-join-path.ts';
import type { JoinPlan } from '@/data/compiler/resolve-join-path.ts';
import type { ResultColumn } from '@/data/compiler/result-columns.ts';
import { quoteIdentifier } from '@/data/duckdb/identifier-safety.ts';
import type { AnalysisQuery } from '@/domain/analysis/analysis-query.ts';
import { expressionColumnIds } from '@/domain/analysis/derived-expression.ts';
import type { Column, Dataset } from '@/domain/dataset/dataset.ts';
import type { DerivedColumn } from '@/domain/dataset/derived-column.ts';
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
  // Datasets read by the query, with the anchor first.
  datasetIds: EntityId[];
  // True when the query crosses a relationship.
  joined: boolean;
}

export type QueryDataset = Pick<Dataset, 'id' | 'relationId' | 'columns'>;

// Data and planner metadata needed to compile a query.
export interface QueryContext {
  datasets: readonly QueryDataset[];
  relationships?: readonly Relationship[];
  // Derived columns available to the query, keyed by ID.
  derivedColumns?: Record<EntityId, DerivedColumn>;
  // Planner hint ordering non-anchor datasets in the FROM/JOIN chain.
  joinOrder?: readonly EntityId[];
}

// Generates the safe table aliases used for joined datasets.
export const joinAlias = (index: number): string => `t${index}`;

const missingColumn = (columnId: EntityId): DomainError =>
  domainError('COLUMN_NOT_FOUND', 'The query references a column that does not exist.', { columnId });

const normalizeContext = (context: QueryDataset | QueryContext): QueryContext =>
  'datasets' in context ? context : { datasets: [context] };

// Builds the column resolver and matching FROM/JOIN clause for a resolved plan.
const buildFromClause = (
  plan: JoinPlan,
  datasets: readonly QueryDataset[],
  anchor: QueryDataset,
): Result<{ sql: string; resolve: ColumnReferenceResolver }, DomainError> => {
  const aliases = new Map<EntityId, string>();

  for (const [index, datasetId] of plan.datasetIds.entries()) {
    aliases.set(datasetId, joinAlias(index));
  }

  const datasetFor = (datasetId: EntityId): QueryDataset | undefined =>
    datasets.find((candidate) => candidate.id === datasetId);

  // Keep single-dataset queries unaliased; aliases are needed only when relations are joined.
  const unjoined = plan.steps.length === 0;

  const referenceFor = (dataset: QueryDataset, column: Column): string =>
    unjoined
      ? quoteIdentifier(column.physicalName)
      : `${quoteIdentifier(aliases.get(dataset.id) as string)}.${quoteIdentifier(column.physicalName)}`;

  const resolve: ColumnReferenceResolver = (columnId) => {
    for (const datasetId of plan.datasetIds) {
      const dataset = datasetFor(datasetId);
      const column = dataset?.columns.find((candidate) => candidate.id === columnId);

      if (dataset !== undefined && column !== undefined) {
        return { sql: referenceFor(dataset, column), column };
      }
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

      if (left === undefined) {
        return err(missingColumn(pair.leftColumnId));
      }
      if (right === undefined) {
        return err(missingColumn(pair.rightColumnId));
      }

      conditions.push(`${left.sql} = ${right.sql}`);
    }

    if (conditions.length === 0) {
      return err(
        domainError('UNSUPPORTED_OPERATION', 'A relationship must declare at least one key column pair.', {
          relationshipId: step.relationship.id,
        }),
      );
    }

    // Emit LEFT JOIN relative to traversal direction so the existing chain remains the preserved side.
    const keyword = step.relationship.join === 'left' ? 'LEFT JOIN' : 'INNER JOIN';

    fragments.push(
      `${keyword} ${quoteIdentifier(joined.relationId)} AS ${quoteIdentifier(aliases.get(joined.id) as string)} ON ${conditions.join(' AND ')}`,
    );
  }

  return ok({ sql: fragments.join(' '), resolve });
};

// Compiles an `AnalysisQuery` to parameterized SQL.
export const compileAnalysisQuery = (
  query: AnalysisQuery,
  context: QueryDataset | QueryContext,
): Result<CompiledQuery, DomainError> => {
  const { datasets, relationships = [], derivedColumns = {}, joinOrder } = normalizeContext(context);
  const anchor = datasets.find((candidate) => candidate.id === query.datasetId);

  if (anchor === undefined) {
    return err(domainError('DATASET_NOT_FOUND', 'The query does not target the resolved dataset.'));
  }

  // Join resolution follows derived references to the physical columns they read.
  const throughDerived = (columnId: EntityId): EntityId[] => {
    const derived = derivedColumns[columnId];

    return derived === undefined ? [columnId] : expressionColumnIds(derived.expression).flatMap(throughDerived);
  };

  const referencedColumnIds = [
    ...query.dimensions,
    ...(query.binnedDimensions ?? []).map((bin) => bin.columnId),
    ...query.measures.flatMap((measure) => (measure.columnId === undefined ? [] : [measure.columnId])),
    ...(query.distribution === undefined
      ? []
      : [
          query.distribution.columnId,
          ...(query.distribution.categoryColumnId === undefined ? [] : [query.distribution.categoryColumnId]),
        ]),
    ...(query.orderBy ?? []).flatMap((sort) => (sort.columnId === undefined ? [] : [sort.columnId])),
    ...query.filters.flatMap(collectFilterColumnIds),
  ].flatMap(throughDerived);

  const requiredDatasetIds = datasetIdsForColumns(referencedColumnIds, datasets);

  // Restrict the hint to required datasets so it cannot add or remove a join.
  const orderedDatasetIds =
    joinOrder === undefined
      ? requiredDatasetIds
      : [
          ...joinOrder.filter((datasetId) => requiredDatasetIds.includes(datasetId)),
          ...requiredDatasetIds.filter((datasetId) => !joinOrder.includes(datasetId)),
        ];

  const plan = resolveJoinPath(anchor.id, orderedDatasetIds, relationships, query.relationshipIds);

  if (!plan.ok) {
    return plan;
  }

  const from = buildFromClause(plan.value, datasets, anchor);

  if (!from.ok) {
    return from;
  }

  const { resolve } = from.value;

  const select: string[] = [];
  // Use SELECT positions in GROUP BY so parameterized expressions are not emitted twice.
  const groupBy: string[] = [];
  const resultColumns: ResultColumn[] = [];
  // Records the SELECT position used by GROUP BY.
  const groupBySelectPosition = (): void => {
    groupBy.push(`${select.length}`);
  };

  // Dimension parameters come first because their placeholders appear in SELECT.
  const dimensionParameters: unknown[] = [];
  const derivedContext = { resolve, derivedColumns };
  // Window-function bins computed per row in a subquery, then grouped by the outer query.
  const quantileBins: { sql: string; alias: string; parameters: unknown[] }[] = [];

  for (const columnId of query.dimensions) {
    const derived = derivedColumns[columnId];

    if (derived !== undefined) {
      const compiled = compileDerivedExpression(derived.expression, derivedContext);
      if (!compiled.ok) {
        return compiled;
      }
      select.push(compiled.value.sql);
      groupBySelectPosition();
      dimensionParameters.push(...compiled.value.parameters);
      resultColumns.push({ key: derived.id, name: derived.name, logicalType: derived.logicalType });
      continue;
    }

    const resolved = resolve(columnId);
    if (resolved === undefined) {
      return err(missingColumn(columnId));
    }
    select.push(resolved.sql);
    groupBySelectPosition();
    resultColumns.push({
      key: resolved.column.id,
      name: resolved.column.name,
      logicalType: resolved.column.logicalType,
    });
  }

  for (const bin of query.binnedDimensions ?? []) {
    const resolved = resolve(bin.columnId);
    if (resolved === undefined) {
      return err(missingColumn(bin.columnId));
    }

    const compiled = compileBinStrategy(bin.strategy, resolved.sql, bin.range);
    if (!compiled.ok) {
      return compiled;
    }

    /*
     * A quantile bin compiles to `NTILE(...) OVER (...)`. SQL forbids a window function in GROUP BY
     * and forbids mixing one with an aggregate over the same level, so the bucket is computed per row
     * in a subquery and the outer query groups by the resulting column.
     */
    if (bin.strategy.kind === 'quantile') {
      const alias = `bin${quantileBins.length}`;

      quantileBins.push({ sql: compiled.value.sql, alias, parameters: compiled.value.parameters });
      select.push(quoteIdentifier(alias));
      groupBySelectPosition();
    } else {
      select.push(compiled.value.sql);
      dimensionParameters.push(...compiled.value.parameters);
      groupBySelectPosition();
    }

    resultColumns.push({
      key: resolved.column.id,
      name: resolved.column.name,
      logicalType: bin.strategy.kind === 'temporal' ? resolved.column.logicalType : 'number',
    });
  }

  const measureAliases = new Map<string, string>();
  const aggregateByMeasure = new Map<(typeof query.measures)[number], string>();
  for (const [index, measure] of query.measures.entries()) {
    const derived = measure.columnId === undefined ? undefined : derivedColumns[measure.columnId];
    let reference: string | undefined;
    let column: Column | undefined;

    if (derived !== undefined) {
      const compiled = compileDerivedExpression(derived.expression, derivedContext);
      if (!compiled.ok) {
        return compiled;
      }
      reference = compiled.value.sql;
      dimensionParameters.push(...compiled.value.parameters);
      // Preserve the derived type so aggregate validation matches physical columns.
      column = {
        id: derived.id,
        name: derived.name,
        physicalName: '',
        databaseType: '',
        logicalType: derived.logicalType,
        nullable: true,
      };
    } else if (measure.columnId !== undefined) {
      const resolved = resolve(measure.columnId);
      if (resolved === undefined) {
        return err(missingColumn(measure.columnId));
      }
      reference = resolved.sql;
      column = resolved.column;
    }

    const aggregate = compileAggregate(measure.aggregate, column, reference);
    if (!aggregate.ok) {
      return aggregate;
    }
    aggregateByMeasure.set(measure, aggregate.value);

    // Time comparisons replace the query with a date spine below, so retain the base aggregate here.
    const modified =
      measure.modifier?.kind === 'timeComparison'
        ? ok({ sql: aggregate.value, parameters: [] })
        : compileMetricModifier(measure.modifier, aggregate.value, resolve);
    if (!modified.ok) {
      return modified;
    }

    const alias = `m${index}`;
    select.push(`${modified.value.sql} AS ${quoteIdentifier(alias)}`);
    dimensionParameters.push(...modified.value.parameters);
    if (measure.alias !== undefined) {
      measureAliases.set(measure.alias, alias);
    }
    resultColumns.push({
      key: measure.alias ?? alias,
      name: measure.alias ?? measure.aggregate,
      logicalType: 'number',
    });
  }

  // Box plots return the five-number summary consumed by ECharts.
  if (query.distribution !== undefined) {
    const target = resolve(query.distribution.columnId);
    if (target === undefined) {
      return err(missingColumn(query.distribution.columnId));
    }

    if (query.distribution.categoryColumnId !== undefined) {
      const category = resolve(query.distribution.categoryColumnId);
      if (category === undefined) {
        return err(missingColumn(query.distribution.categoryColumnId));
      }
      select.unshift(category.sql);
      // The category shifts existing SELECT positions by one.
      for (const [index, position] of groupBy.entries()) {
        groupBy[index] = `${Number(position) + 1}`;
      }
      groupBy.unshift('1');
      resultColumns.unshift({
        key: category.column.id,
        name: category.column.name,
        logicalType: category.column.logicalType,
      });
    }

    const quartile = (fraction: number): string => `quantile_cont(${target.sql}, ${fraction})`;
    const summary: [string, string][] = [
      ['q0', `MIN(${target.sql})`],
      ['q1', quartile(0.25)],
      ['q2', quartile(0.5)],
      ['q3', quartile(0.75)],
      ['q4', `MAX(${target.sql})`],
    ];

    for (const [key, expression] of summary) {
      select.push(`${expression} AS ${quoteIdentifier(key)}`);
      resultColumns.push({ key, name: key, logicalType: 'number' });
    }
  }

  if (select.length === 0) {
    // A bare projection selects only the anchor's columns.
    for (const column of anchor.columns) {
      select.push(
        plan.value.steps.length === 0
          ? quoteIdentifier(column.physicalName)
          : `${quoteIdentifier(joinAlias(0))}.${quoteIdentifier(column.physicalName)}`,
      );
      resultColumns.push({ key: column.id, name: column.name, logicalType: column.logicalType });
    }
  }

  const whereParameters: unknown[] = [];
  const where: string[] = [];
  for (const filter of query.filters) {
    const compiled = compileFilterExpression(filter, resolve);
    if (!compiled.ok) {
      return compiled;
    }
    where.push(`(${compiled.value.sql})`);
    whereParameters.push(...compiled.value.parameters);
  }

  // Time comparisons replace the ordinary SELECT with a generated date-spine query.
  const comparison = query.measures.find((measure) => measure.modifier?.kind === 'timeComparison');

  if (comparison !== undefined) {
    const spine = compileTimeSpine({
      modifier: comparison.modifier as Extract<NonNullable<typeof comparison.modifier>, { kind: 'timeComparison' }>,
      aggregate: aggregateByMeasure.get(comparison) as string,
      from: from.value.sql,
      where: where.join(' AND '),
      whereParameters,
      resolve,
      limit: Math.min(Math.max(Math.trunc(query.limit ?? DEFAULT_QUERY_LIMIT), 1), MAX_QUERY_LIMIT),
    });

    if (!spine.ok) {
      return spine;
    }

    return ok({
      sql: spine.value.sql,
      parameters: spine.value.parameters,
      resultColumns: [
        { key: 'd0', name: 'period', logicalType: 'timestamp' },
        { key: 'm0', name: comparison.alias ?? comparison.aggregate, logicalType: 'number' },
        { key: 'm1', name: 'comparison', logicalType: 'number' },
      ],
      datasetIds: plan.value.datasetIds,
      joined: plan.value.steps.length > 0,
    });
  }

  const orderBy: string[] = [];
  for (const sort of query.orderBy ?? []) {
    if (sort.columnId !== undefined) {
      const resolved = resolve(sort.columnId);
      if (resolved === undefined) {
        return err(missingColumn(sort.columnId));
      }
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

  /*
   * A quantile bin needs its window function evaluated per row before the outer query aggregates it.
   * The subquery applies the filters so the buckets are computed over the filtered rows only, and the
   * outer query reads the bucket by alias. Parameter order follows the emitted text: the subquery's
   * bin and filter placeholders bind before the outer SELECT's remaining dimension placeholders.
   */
  const source =
    quantileBins.length === 0
      ? { sql: from.value.sql, parameters: [...dimensionParameters, ...whereParameters], where }
      : {
          sql: `(SELECT *, ${quantileBins
            .map((bin) => `${bin.sql} AS ${quoteIdentifier(bin.alias)}`)
            .join(', ')} FROM ${from.value.sql}${where.length === 0 ? '' : ` WHERE ${where.join(' AND ')}`})`,
          parameters: [...quantileBins.flatMap((bin) => bin.parameters), ...whereParameters, ...dimensionParameters],
          // Filters are applied inside the subquery, so the outer query must not repeat them.
          where: [] as string[],
        };

  const sql = [
    `SELECT ${select.join(', ')} FROM ${source.sql}`,
    source.where.length === 0 ? '' : `WHERE ${source.where.join(' AND ')}`,
    groupBy.length > 0 && (query.measures.length > 0 || query.distribution !== undefined)
      ? `GROUP BY ${groupBy.join(', ')}`
      : '',
    orderBy.length === 0 ? '' : `ORDER BY ${orderBy.join(', ')}`,
    `LIMIT ${limit}`,
    offset === 0 ? '' : `OFFSET ${offset}`,
  ]
    .filter(Boolean)
    .join(' ');

  return ok({
    sql,
    parameters: source.parameters,
    resultColumns,
    datasetIds: plan.value.datasetIds,
    joined: plan.value.steps.length > 0,
  });
};

// Collects column IDs named by a filter tree.
function collectFilterColumnIds(expression: AnalysisQuery['filters'][number]): EntityId[] {
  if (expression.kind === 'comparison') {
    return [expression.columnId];
  }
  if (expression.kind === 'not') {
    return collectFilterColumnIds(expression.operand);
  }

  return expression.operands.flatMap(collectFilterColumnIds);
}
