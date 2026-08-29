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
import { MAX_TIME_COMPARISON_OFFSET } from '@/domain/metric/metric-modifier.ts';
import type { MetricModifier } from '@/domain/metric/metric-modifier.ts';
import type { Workspace } from '@/domain/workspace/workspace.ts';
import { domainError } from '@/shared/errors/domain-error.ts';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import { createEntityId, ID_PREFIX } from '@/shared/ids/entity-id.ts';
import type { EntityId } from '@/shared/ids/entity-id.ts';
import { err, ok } from '@/shared/result/result.ts';
import type { Result } from '@/shared/result/result.ts';

export const MAX_METRIC_NAME_LENGTH = 80;

/**
 * Aggregates that require a numeric column.
 *
 * `count` needs no column at all, and `count_distinct`, `min`, and `max` are meaningful over text
 * and temporal columns too, so only the arithmetic aggregates are restricted.
 */
const NUMERIC_ONLY_AGGREGATES = new Set(['sum', 'avg', 'median', 'stddev']);

/**
 * Checks a modifier's references against the metric's own dataset.
 *
 * `timeComparison` is the one that earns the scrutiny: it names a date column, and pointing it at a
 * numeric one would produce a `date_trunc` DuckDB rejects at run time rather than a corrective
 * message the caller can act on.
 */
const validateModifier = (
  workspace: Workspace,
  datasetId: EntityId,
  modifier: MetricModifier,
): Result<void, DomainError> => {
  if (modifier.kind === 'none' || modifier.kind === 'percentOfTotal') return ok(undefined);

  const dataset = resolveDataset(workspace, datasetId);

  if (!dataset.ok) return dataset;

  if (modifier.kind === 'runningTotal') {
    const column = resolveColumn(dataset.value, modifier.orderBy);

    return column.ok ? ok(undefined) : column;
  }

  const column = resolveColumn(dataset.value, modifier.dateColumnId);

  if (!column.ok) return column;

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

/**
 * Creates a metric.
 *
 * Metric *evaluation* needs the analytical engine, but its definition is metadata, so creation is
 * complete here. Evaluating a stored definition happens when a consumer requests its value.
 */
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

  if (!dataset.ok) return dataset;

  if (payload.aggregate === 'count') {
    if (payload.columnId !== undefined) {
      return err(
        domainError('UNSUPPORTED_OPERATION', "Aggregate 'count' counts rows and takes no column.", {
          aggregate: payload.aggregate,
        }),
      );
    }
  } else {
    if (payload.columnId === undefined) {
      return err(
        domainError('INCOMPATIBLE_COLUMN', `Aggregate '${payload.aggregate}' requires a column.`, {
          aggregate: payload.aggregate,
        }),
      );
    }

    const column = resolveColumn(dataset.value, payload.columnId);

    if (!column.ok) return column;

    if (NUMERIC_ONLY_AGGREGATES.has(payload.aggregate) && !isNumericType(column.value.logicalType)) {
      return err(
        domainError(
          'INCOMPATIBLE_COLUMN',
          `Aggregate '${payload.aggregate}' requires a numeric column; '${column.value.name}' is ${column.value.logicalType}.`,
          { aggregate: payload.aggregate, columnId: column.value.id, logicalType: column.value.logicalType },
        ),
      );
    }
  }

  for (const filterId of payload.filters ?? []) {
    const filter = resolveFilter(workspace, filterId);

    if (!filter.ok) return filter;

    if (filter.value.datasetId !== dataset.value.id) {
      return err(
        domainError('INCOMPATIBLE_COLUMN', `Filter '${filterId}' belongs to a different dataset.`, {
          filterId,
          datasetId: dataset.value.id,
        }),
      );
    }
  }

  if (payload.modifier !== undefined) {
    const modifier = validateModifier(workspace, dataset.value.id, payload.modifier);

    if (!modifier.ok) return modifier;
  }

  const metric: Metric = {
    id: createEntityId(ID_PREFIX.metric),
    datasetId: dataset.value.id,
    name,
    aggregate: payload.aggregate,
    ...(payload.columnId === undefined ? {} : { columnId: payload.columnId }),
    filters: payload.filters ?? [],
    ...(payload.format === undefined ? {} : { format: payload.format }),
    ...(payload.modifier === undefined ? {} : { modifier: payload.modifier }),
    createdBy: deps.actor,
  };

  return ok({
    workspace: { ...workspace, metrics: { ...workspace.metrics, [metric.id]: metric } },
    changedEntityIds: [metric.id],
    summary: `Created ${metric.aggregate} metric '${metric.name}'.`,
  });
};

/**
 * Updates a metric in place.
 *
 * Every supplied field is re-validated against the merged definition rather than in isolation, so
 * changing only the aggregate still checks it against the column the metric already had.
 */
export const handleUpdateMetric: ActionHandler<UpdateMetricInput> = (workspace, payload) => {
  const existing = resolveMetric(workspace, payload.metricId);

  if (!existing.ok) return existing;

  const name = payload.name === undefined ? existing.value.name : payload.name.trim();

  if (name.length === 0 || name.length > MAX_METRIC_NAME_LENGTH) {
    return err(
      domainError('UNSUPPORTED_OPERATION', `Metric name must be between 1 and ${MAX_METRIC_NAME_LENGTH} characters.`, {
        maxLength: MAX_METRIC_NAME_LENGTH,
      }),
    );
  }

  const dataset = resolveDataset(workspace, existing.value.datasetId);

  if (!dataset.ok) return dataset;

  const aggregate = payload.aggregate ?? existing.value.aggregate;
  const columnId = payload.columnId ?? existing.value.columnId;

  if (aggregate === 'count') {
    if (columnId !== undefined && payload.aggregate === 'count' && payload.columnId !== undefined) {
      return err(
        domainError('UNSUPPORTED_OPERATION', "Aggregate 'count' counts rows and takes no column.", { aggregate }),
      );
    }
  } else {
    if (columnId === undefined) {
      return err(domainError('INCOMPATIBLE_COLUMN', `Aggregate '${aggregate}' requires a column.`, { aggregate }));
    }

    const column = resolveColumn(dataset.value, columnId);

    if (!column.ok) return column;

    if (NUMERIC_ONLY_AGGREGATES.has(aggregate) && !isNumericType(column.value.logicalType)) {
      return err(
        domainError(
          'INCOMPATIBLE_COLUMN',
          `Aggregate '${aggregate}' requires a numeric column; '${column.value.name}' is ${column.value.logicalType}.`,
          { aggregate, columnId: column.value.id, logicalType: column.value.logicalType },
        ),
      );
    }
  }

  for (const filterId of payload.filters ?? existing.value.filters) {
    const filter = resolveFilter(workspace, filterId);

    if (!filter.ok) return filter;

    if (filter.value.datasetId !== dataset.value.id) {
      return err(
        domainError('INCOMPATIBLE_COLUMN', `Filter '${filterId}' belongs to a different dataset.`, {
          filterId,
          datasetId: dataset.value.id,
        }),
      );
    }
  }

  if (payload.modifier !== undefined) {
    const modifier = validateModifier(workspace, existing.value.datasetId, payload.modifier);

    if (!modifier.ok) return modifier;
  }

  const metric: Metric = {
    ...existing.value,
    name,
    aggregate,
    ...(aggregate === 'count' ? {} : columnId === undefined ? {} : { columnId }),
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

  if (!metric.ok) return metric;

  return ok({
    workspace: { ...workspace, metrics: omitKeys(workspace.metrics, [metric.value.id]) },
    changedEntityIds: [metric.value.id],
    summary: `Removed metric '${metric.value.name}'.`,
  });
};
