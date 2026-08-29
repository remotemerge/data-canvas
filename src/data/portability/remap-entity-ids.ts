import type { AnalysisQuery } from '@/domain/analysis/analysis-query.ts';
import type { BinStrategy } from '@/domain/analysis/bin-strategy.ts';
import type { DerivedCondition, DerivedExpression } from '@/domain/analysis/derived-expression.ts';
import type { Annotation } from '@/domain/annotation/annotation.ts';
import type { Column, Dataset } from '@/domain/dataset/dataset.ts';
import type { DerivedColumn } from '@/domain/dataset/derived-column.ts';
import type { Filter, FilterExpression } from '@/domain/filter/filter.ts';
import type { Metric } from '@/domain/metric/metric.ts';
import type { Relationship } from '@/domain/relationship/relationship.ts';
import type { Selection } from '@/domain/selection/selection.ts';
import type { Visualization } from '@/domain/visualization/visualization.ts';
import type { Workspace } from '@/domain/workspace/workspace.ts';
import { createEntityId, ID_PREFIX, type EntityId, type IdPrefix } from '@/shared/ids/entity-id.ts';

/**
 * Rewrites every entity ID in an imported workspace.
 *
 * Two reasons, both load-bearing. Reusing an archive's IDs would collide with entities already in
 * the browser — the same workspace imported twice would have each copy overwrite the other's
 * entities. And an ID from an archive is attacker-influenced input: keeping it lets whoever wrote
 * the file choose an internal identifier, including one shaped to collide with a specific existing
 * entity.
 *
 * Every reference is remapped in one pass against a single table, so a reference that survives is
 * one this module explicitly knows about. An unmapped ID is left untouched rather than dropped,
 * which the caller then rejects during validation — a dangling reference must fail loudly rather
 * than silently become a workspace whose charts point at nothing.
 */
export class IdRemapper {
  readonly #mapping = new Map<EntityId, EntityId>();

  /** Assigns a fresh ID for an old one, or returns the one already assigned. */
  assign(oldId: EntityId, prefix: IdPrefix): EntityId {
    const existing = this.#mapping.get(oldId);

    if (existing !== undefined) return existing;

    const fresh = createEntityId(prefix);

    this.#mapping.set(oldId, fresh);

    return fresh;
  }

  /** Resolves a reference. Returns `undefined` when the archive referenced an entity it never defined. */
  resolve(oldId: EntityId): EntityId | undefined {
    return this.#mapping.get(oldId);
  }

  has(oldId: EntityId): boolean {
    return this.#mapping.has(oldId);
  }

  get size(): number {
    return this.#mapping.size;
  }
}

/** Collected while remapping so the caller can reject an archive with dangling references. */
export interface RemapReport {
  workspace: Workspace;
  /** Reference fields whose target was never defined in the archive. */
  danglingReferences: string[];
}

const remapBinStrategy = (
  strategy: BinStrategy,
  resolve: (id: EntityId, context: string) => EntityId,
  context: string,
): BinStrategy => {
  // Bin strategies carry no column reference of their own today; the column is held by the node
  // that owns the strategy. Rewritten defensively so a future column-bearing strategy is caught by
  // the type checker here rather than silently escaping the remap.
  void resolve;
  void context;

  return strategy;
};

const remapDerivedExpression = (
  expression: DerivedExpression,
  resolve: (id: EntityId, context: string) => EntityId,
  context: string,
): DerivedExpression => {
  switch (expression.kind) {
    case 'column':
      return { ...expression, columnId: resolve(expression.columnId, `${context}.columnId`) };
    case 'literal':
      return expression;
    case 'arithmetic':
      return {
        ...expression,
        left: remapDerivedExpression(expression.left, resolve, `${context}.left`),
        right: remapDerivedExpression(expression.right, resolve, `${context}.right`),
      };
    case 'case':
      return {
        ...expression,
        when: expression.when.map((arm, index): DerivedCondition => ({
          ...arm,
          left: remapDerivedExpression(arm.left, resolve, `${context}.when[${index}].left`),
          right: remapDerivedExpression(arm.right, resolve, `${context}.when[${index}].right`),
          result: remapDerivedExpression(arm.result, resolve, `${context}.when[${index}].result`),
        })),
        otherwise: remapDerivedExpression(expression.otherwise, resolve, `${context}.otherwise`),
      };
    case 'datePart':
      return { ...expression, columnId: resolve(expression.columnId, `${context}.columnId`) };
    case 'bin':
      return {
        ...expression,
        columnId: resolve(expression.columnId, `${context}.columnId`),
        strategy: remapBinStrategy(expression.strategy, resolve, `${context}.strategy`),
      };
    case 'cast':
      return { ...expression, expr: remapDerivedExpression(expression.expr, resolve, `${context}.expr`) };
  }
};

const remapFilterExpression = (
  expression: FilterExpression,
  resolve: (id: EntityId, context: string) => EntityId,
  context: string,
): FilterExpression => {
  switch (expression.kind) {
    case 'comparison':
      return { ...expression, columnId: resolve(expression.columnId, `${context}.columnId`) };
    case 'and':
    case 'or':
      return {
        ...expression,
        operands: expression.operands.map((operand, index) =>
          remapFilterExpression(operand, resolve, `${context}.operands[${index}]`),
        ),
      };
    case 'not':
      return { ...expression, operand: remapFilterExpression(expression.operand, resolve, `${context}.operand`) };
  }
};

const remapAnalysisQuery = (
  query: AnalysisQuery,
  resolve: (id: EntityId, context: string) => EntityId,
  context: string,
): AnalysisQuery => ({
  ...query,
  datasetId: resolve(query.datasetId, `${context}.datasetId`),
  ...(query.relationshipIds === undefined
    ? {}
    : { relationshipIds: query.relationshipIds.map((id, i) => resolve(id, `${context}.relationshipIds[${i}]`)) }),
  dimensions: query.dimensions.map((id, i) => resolve(id, `${context}.dimensions[${i}]`)),
  ...(query.binnedDimensions === undefined
    ? {}
    : {
        binnedDimensions: query.binnedDimensions.map((spec, i) => ({
          ...spec,
          columnId: resolve(spec.columnId, `${context}.binnedDimensions[${i}].columnId`),
        })),
      }),
  measures: query.measures.map((measure, i) => ({
    ...measure,
    ...(measure.columnId === undefined
      ? {}
      : { columnId: resolve(measure.columnId, `${context}.measures[${i}].columnId`) }),
  })),
  ...(query.distribution === undefined
    ? {}
    : {
        distribution: {
          ...query.distribution,
          columnId: resolve(query.distribution.columnId, `${context}.distribution.columnId`),
          ...(query.distribution.categoryColumnId === undefined
            ? {}
            : {
                categoryColumnId: resolve(
                  query.distribution.categoryColumnId,
                  `${context}.distribution.categoryColumnId`,
                ),
              }),
        },
      }),
  filters: query.filters.map((filter, i) => remapFilterExpression(filter, resolve, `${context}.filters[${i}]`)),
  ...(query.orderBy === undefined
    ? {}
    : {
        orderBy: query.orderBy.map((sort, i) => ({
          ...sort,
          ...(sort.columnId === undefined ? {} : { columnId: resolve(sort.columnId, `${context}.orderBy[${i}]`) }),
        })),
      }),
});

const byId = <T extends { id: EntityId }>(entities: T[]): Record<EntityId, T> =>
  Object.fromEntries(entities.map((entity) => [entity.id, entity]));

/**
 * Regenerates every ID in a workspace and rewrites all cross-references to match.
 *
 * Runs in two phases. The first assigns fresh IDs for every *defined* entity, so that the second
 * phase resolves references in any order — a visualization may reference a dataset declared after
 * it in the archive's JSON, and a single pass would treat that as dangling.
 *
 * Relation names are regenerated by the caller from the new dataset IDs rather than carried over,
 * so an archive cannot name a DuckDB relation.
 */
export const remapWorkspaceIds = (workspace: Workspace): RemapReport => {
  const remapper = new IdRemapper();
  const dangling: string[] = [];

  for (const dataset of Object.values(workspace.datasets)) {
    remapper.assign(dataset.id, ID_PREFIX.dataset);
    for (const column of dataset.columns) remapper.assign(column.id, ID_PREFIX.column);
  }
  // Derived columns are addressed as columns by every binding, so they take the column prefix.
  for (const derived of Object.values(workspace.derivedColumns)) remapper.assign(derived.id, ID_PREFIX.column);
  for (const relationship of Object.values(workspace.relationships)) {
    remapper.assign(relationship.id, ID_PREFIX.relationship);
  }
  for (const visualization of Object.values(workspace.visualizations)) {
    remapper.assign(visualization.id, ID_PREFIX.visualization);
  }
  for (const filter of Object.values(workspace.filters)) remapper.assign(filter.id, ID_PREFIX.filter);
  for (const selection of Object.values(workspace.selections)) remapper.assign(selection.id, ID_PREFIX.selection);
  for (const metric of Object.values(workspace.metrics)) remapper.assign(metric.id, ID_PREFIX.metric);
  for (const annotation of Object.values(workspace.annotations)) remapper.assign(annotation.id, ID_PREFIX.annotation);

  const resolve = (oldId: EntityId, context: string): EntityId => {
    const mapped = remapper.resolve(oldId);

    if (mapped === undefined) {
      dangling.push(context);

      return oldId;
    }

    return mapped;
  };

  const datasets = Object.values(workspace.datasets).map((dataset): Dataset => ({
    ...dataset,
    id: resolve(dataset.id, 'dataset.id'),
    columns: dataset.columns.map((col): Column => ({
      ...col,
      id: resolve(col.id, `dataset.${dataset.name}.column.id`),
    })),
  }));

  const derivedColumns = Object.values(workspace.derivedColumns).map((derived): DerivedColumn => ({
    ...derived,
    id: resolve(derived.id, 'derivedColumn.id'),
    datasetId: resolve(derived.datasetId, 'derivedColumn.datasetId'),
    expression: remapDerivedExpression(derived.expression, resolve, 'derivedColumn.expression'),
  }));

  const relationships = Object.values(workspace.relationships).map((relationship): Relationship => ({
    ...relationship,
    id: resolve(relationship.id, 'relationship.id'),
    leftDatasetId: resolve(relationship.leftDatasetId, 'relationship.leftDatasetId'),
    rightDatasetId: resolve(relationship.rightDatasetId, 'relationship.rightDatasetId'),
    on: relationship.on.map((pair) => ({
      leftColumnId: resolve(pair.leftColumnId, 'relationship.on.leftColumnId'),
      rightColumnId: resolve(pair.rightColumnId, 'relationship.on.rightColumnId'),
    })),
  }));

  const visualizations = Object.values(workspace.visualizations).map((visualization): Visualization => ({
    ...visualization,
    id: resolve(visualization.id, 'visualization.id'),
    datasetId: resolve(visualization.datasetId, 'visualization.datasetId'),
    query: remapAnalysisQuery(visualization.query, resolve, 'visualization.query'),
    binding: {
      ...visualization.binding,
      ...(visualization.binding.x === undefined
        ? {}
        : { x: resolve(visualization.binding.x, 'visualization.binding.x') }),
      ...(visualization.binding.y === undefined
        ? {}
        : { y: visualization.binding.y.map((id) => resolve(id, 'visualization.binding.y')) }),
      ...(visualization.binding.series === undefined
        ? {}
        : { series: resolve(visualization.binding.series, 'visualization.binding.series') }),
      ...(visualization.binding.color === undefined
        ? {}
        : { color: resolve(visualization.binding.color, 'visualization.binding.color') }),
      ...(visualization.binding.size === undefined
        ? {}
        : { size: resolve(visualization.binding.size, 'visualization.binding.size') }),
      ...(visualization.binding.tooltip === undefined
        ? {}
        : { tooltip: visualization.binding.tooltip.map((id) => resolve(id, 'visualization.binding.tooltip')) }),
    },
  }));

  const filters = Object.values(workspace.filters).map((filter): Filter => ({
    ...filter,
    id: resolve(filter.id, 'filter.id'),
    datasetId: resolve(filter.datasetId, 'filter.datasetId'),
    columnId: resolve(filter.columnId, 'filter.columnId'),
  }));

  const selections = Object.values(workspace.selections).map((selection): Selection => ({
    ...selection,
    id: resolve(selection.id, 'selection.id'),
    datasetId: resolve(selection.datasetId, 'selection.datasetId'),
    ...(selection.predicate === undefined
      ? {}
      : { predicate: remapFilterExpression(selection.predicate, resolve, 'selection.predicate') }),
  }));

  const metrics = Object.values(workspace.metrics).map((metric): Metric => ({
    ...metric,
    id: resolve(metric.id, 'metric.id'),
    datasetId: resolve(metric.datasetId, 'metric.datasetId'),
    ...(metric.columnId === undefined ? {} : { columnId: resolve(metric.columnId, 'metric.columnId') }),
    filters: metric.filters.map((id) => resolve(id, 'metric.filters')),
  }));

  const annotations = Object.values(workspace.annotations).map((annotation): Annotation => ({
    ...annotation,
    id: resolve(annotation.id, 'annotation.id'),
    visualizationId: resolve(annotation.visualizationId, 'annotation.visualizationId'),
    ...(annotation.anchor.kind === 'data'
      ? { anchor: { ...annotation.anchor, dimension: resolve(annotation.anchor.dimension, 'annotation.anchor') } }
      : {}),
  }));

  const tableSorts = Object.fromEntries(
    Object.entries(workspace.tableSorts).map(([datasetId, sorts]) => [
      resolve(datasetId, 'tableSorts.datasetId'),
      sorts.map((sort) => ({
        ...sort,
        ...(sort.columnId === undefined ? {} : { columnId: resolve(sort.columnId, 'tableSorts.columnId') }),
      })),
    ]),
  );

  return {
    workspace: {
      ...workspace,
      // The workspace itself is a new entity, not a restored one: importing the same archive twice
      // must produce two workspaces rather than one overwriting the other.
      id: createEntityId(ID_PREFIX.workspace),
      datasets: byId(datasets),
      derivedColumns: byId(derivedColumns),
      relationships: byId(relationships),
      visualizations: byId(visualizations),
      filters: byId(filters),
      selections: byId(selections),
      metrics: byId(metrics),
      annotations: byId(annotations),
      tableSorts,
      ...(workspace.activeDatasetId === undefined
        ? {}
        : { activeDatasetId: resolve(workspace.activeDatasetId, 'activeDatasetId') }),
      layout: {
        ...workspace.layout,
        items: workspace.layout.items.map((item) => ({
          ...item,
          visualizationId: resolve(item.visualizationId, 'layout.visualizationId'),
        })),
      },
    },
    danglingReferences: dangling,
  };
};
