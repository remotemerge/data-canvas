import type { CreateMetricInput, RemoveMetricInput, UpdateMetricInput } from '@/application/actions/action-types.ts';
import { omitKeys } from '@/application/actions/handlers/handler-types.ts';
import type { ActionHandler } from '@/application/actions/handlers/handler-types.ts';
import {
  resolveColumn,
  resolveDataset,
  resolveFilter,
  resolveMetric,
} from '@/application/validation/validate-entity-refs.ts';
import { isNumericType, isTemporalType } from '@/domain/logical-type.ts';
import type { Metric } from '@/domain/metric/metric.ts';
import type { Dataset } from '@/domain/dataset/dataset.ts';
import { MAX_TIME_COMPARISON_OFFSET } from '@/domain/metric/metric-modifier.ts';
import type { MetricModifier } from '@/domain/metric/metric-modifier.ts';
import { domainError } from '@/shared/errors/domain-error.ts';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import { createEntityId, ID_PREFIX } from '@/shared/ids/entity-id.ts';
import { err, ok } from '@/shared/result/result.ts';
import type { Result } from '@/shared/result/result.ts';

export const MAX_METRIC_NAME_LENGTH = 80;

// Aggregates that require numeric input.
const NUMERIC_ONLY_AGGREGATES = new Set(['sum', 'avg', 'median', 'stddev']);

/**
 * Checks the aggregate against the column it summarizes.
 *
 * `explicitColumnId` is what the caller supplied, `columnId` the value after any inherited column is
 * merged in. An update only conflicts when the caller passes a column alongside `count`, since a
 * column inherited from a previous aggregate is dropped rather than rejected.
 */
const validateAggregateColumn = (
  dataset: Dataset,
  aggregate: string,
  columnId: string | undefined,
  explicitColumnId: string | undefined,
): Result<void, DomainError> => {
  if (aggregate === 'count') {
    return explicitColumnId === undefined
      ? ok(undefined)
      : err(domainError('UNSUPPORTED_OPERATION', "Aggregate 'count' counts rows and takes no column.", { aggregate }));
  }

  if (columnId === undefined) {
    return err(domainError('INCOMPATIBLE_COLUMN', `Aggregate '${aggregate}' requires a column.`, { aggregate }));
  }

  const column = resolveColumn(dataset, columnId);

  if (!column.ok) {
    return column;
  }

  if (NUMERIC_ONLY_AGGREGATES.has(aggregate) && !isNumericType(column.value.logicalType)) {
    return err(
      domainError(
        'INCOMPATIBLE_COLUMN',
        `Aggregate '${aggregate}' requires a numeric column; '${column.value.name}' is ${column.value.logicalType}.`,
        { aggregate, columnId: column.value.id, logicalType: column.value.logicalType },
      ),
    );
  }

  return ok(undefined);
};

// A metric may only reference filters defined on its own dataset.
const validateMetricFilters = (
  workspace: Parameters<typeof resolveFilter>[0],
  filterIds: readonly string[],
  datasetId: string,
): Result<void, DomainError> => {
  for (const filterId of filterIds) {
    const filter = resolveFilter(workspace, filterId);

    if (!filter.ok) {
      return filter;
    }

    if (filter.value.datasetId !== datasetId) {
      return err(
        domainError('INCOMPATIBLE_COLUMN', `Filter '${filterId}' belongs to a different dataset.`, {
          filterId,
          datasetId,
        }),
      );
    }
  }

  return ok(undefined);
};

/*
 * Modifiers that express their result as a proportion default to percent formatting, so a ratio is
 * not displayed as a bare decimal. An explicit format always wins.
 */
const defaultFormat = (
  format: Metric['format'] | undefined,
  modifier: MetricModifier | undefined,
): Pick<Metric, 'format'> | Record<string, never> => {
  if (format !== undefined) {
    return { format };
  }

  const isProportional =
    modifier?.kind === 'percentOfTotal' || (modifier?.kind === 'timeComparison' && modifier.as === 'percentChange');

  return isProportional ? { format: { style: 'percent' as const } } : {};
};

// Validates modifier references against the metric's dataset.
const validateModifier = (dataset: Dataset, modifier: MetricModifier): Result<void, DomainError> => {
  if (modifier.kind === 'none' || modifier.kind === 'percentOfTotal') {
    return ok(undefined);
  }

  if (modifier.kind === 'runningTotal') {
    const column = resolveColumn(dataset, modifier.orderBy);

    return column.ok ? ok(undefined) : column;
  }

  const column = resolveColumn(dataset, modifier.dateColumnId);

  if (!column.ok) {
    return column;
  }

  if (!isTemporalType(column.value.logicalType)) {
    return err(
      domainError(
        'INCOMPATIBLE_COLUMN',
        `A time comparison needs a date or timestamp column; '${column.value.name}' is ${column.value.logicalType}.`,
        { columnId: column.value.id, logicalType: column.value.logicalType },
      ),
    );
  }

  if (!Number.isInteger(modifier.offset) || modifier.offset < 1 || modifier.offset > MAX_TIME_COMPARISON_OFFSET) {
    return err(
      domainError(
        'RESULT_LIMIT_EXCEEDED',
        `A time comparison offset must be between 1 and ${MAX_TIME_COMPARISON_OFFSET}.`,
        { offset: modifier.offset, maxOffset: MAX_TIME_COMPARISON_OFFSET },
      ),
    );
  }

  return ok(undefined);
};

// Stores a metric definition; the engine evaluates it when a value is requested.
// Percent-of-total and percent-change modifiers default to percent formatting.
export const handleCreateMetric: ActionHandler<CreateMetricInput> = (workspace, payload, deps) => {
  const name = payload.name.trim();

  if (name.length === 0 || name.length > MAX_METRIC_NAME_LENGTH) {
    return err(
      domainError('UNSUPPORTED_OPERATION', `Metric name must be between 1 and ${MAX_METRIC_NAME_LENGTH} characters.`, {
        maxLength: MAX_METRIC_NAME_LENGTH,
      }),
    );
  }

  const dataset = resolveDataset(workspace, payload.datasetId);

  if (!dataset.ok) {
    return dataset;
  }

  const aggregateColumn = validateAggregateColumn(dataset.value, payload.aggregate, payload.columnId, payload.columnId);

  if (!aggregateColumn.ok) {
    return aggregateColumn;
  }

  const filters = validateMetricFilters(workspace, payload.filters ?? [], dataset.value.id);

  if (!filters.ok) {
    return filters;
  }

  if (payload.modifier !== undefined) {
    const modifier = validateModifier(dataset.value, payload.modifier);

    if (!modifier.ok) {
      return modifier;
    }
  }

  const metric: Metric = {
    id: createEntityId(ID_PREFIX.metric),
    datasetId: dataset.value.id,
    name,
    aggregate: payload.aggregate,
    ...(payload.columnId === undefined ? {} : { columnId: payload.columnId }),
    filters: payload.filters ?? [],
    ...defaultFormat(payload.format, payload.modifier),
    ...(payload.modifier === undefined ? {} : { modifier: payload.modifier }),
    createdBy: deps.actor,
  };

  return ok({
    workspace: { ...workspace, metrics: { ...workspace.metrics, [metric.id]: metric } },
    changedEntityIds: [metric.id],
    summary: `Created ${metric.aggregate} metric '${metric.name}'.`,
  });
};

// Updates a metric after validating the merged definition.
export const handleUpdateMetric: ActionHandler<UpdateMetricInput> = (workspace, payload) => {
  const existing = resolveMetric(workspace, payload.metricId);

  if (!existing.ok) {
    return existing;
  }

  const name = payload.name === undefined ? existing.value.name : payload.name.trim();

  if (name.length === 0 || name.length > MAX_METRIC_NAME_LENGTH) {
    return err(
      domainError('UNSUPPORTED_OPERATION', `Metric name must be between 1 and ${MAX_METRIC_NAME_LENGTH} characters.`, {
        maxLength: MAX_METRIC_NAME_LENGTH,
      }),
    );
  }

  const dataset = resolveDataset(workspace, existing.value.datasetId);

  if (!dataset.ok) {
    return dataset;
  }

  const aggregate = payload.aggregate ?? existing.value.aggregate;
  const columnId = payload.columnId ?? existing.value.columnId;

  const aggregateColumn = validateAggregateColumn(dataset.value, aggregate, columnId, payload.columnId);

  if (!aggregateColumn.ok) {
    return aggregateColumn;
  }

  const filters = validateMetricFilters(workspace, payload.filters ?? existing.value.filters, dataset.value.id);

  if (!filters.ok) {
    return filters;
  }

  if (payload.modifier !== undefined) {
    const modifier = validateModifier(dataset.value, payload.modifier);

    if (!modifier.ok) {
      return modifier;
    }
  }

  // Spreading the existing metric would carry its column into a `count`, so drop it explicitly.
  const { columnId: _existingColumnId, ...retained } = existing.value;

  const metric: Metric = {
    ...retained,
    name,
    aggregate,
    ...(aggregate === 'count' || columnId === undefined ? {} : { columnId }),
    ...(payload.filters === undefined ? {} : { filters: payload.filters }),
    ...(payload.format === undefined ? {} : { format: payload.format }),
    ...(payload.modifier === undefined ? {} : { modifier: payload.modifier }),
  };

  return ok({
    workspace: { ...workspace, metrics: { ...workspace.metrics, [metric.id]: metric } },
    changedEntityIds: [metric.id],
    summary: `Updated metric '${metric.name}'.`,
  });
};

export const handleRemoveMetric: ActionHandler<RemoveMetricInput> = (workspace, payload) => {
  const metric = resolveMetric(workspace, payload.metricId);

  if (!metric.ok) {
    return metric;
  }

  return ok({
    workspace: { ...workspace, metrics: omitKeys(workspace.metrics, [metric.value.id]) },
    changedEntityIds: [metric.value.id],
    summary: `Removed metric '${metric.value.name}'.`,
  });
};
