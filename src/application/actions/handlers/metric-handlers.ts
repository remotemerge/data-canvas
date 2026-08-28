import type { CreateMetricInput, RemoveMetricInput } from '@/application/actions/action-types.ts';
import { omitKeys } from '@/application/actions/handlers/handler-types.ts';
import type { ActionHandler } from '@/application/actions/handlers/handler-types.ts';
import {
  resolveColumn,
  resolveDataset,
  resolveFilter,
  resolveMetric,
} from '@/application/validation/validate-entity-refs.ts';
import { isNumericType } from '@/domain/logical-type.ts';
import type { Metric } from '@/domain/metric/metric.ts';
import { domainError } from '@/shared/errors/domain-error.ts';
import { createEntityId, ID_PREFIX } from '@/shared/ids/entity-id.ts';
import { err, ok } from '@/shared/result/result.ts';

export const MAX_METRIC_NAME_LENGTH = 80;

/**
 * Aggregates that require a numeric column.
 *
 * `count` needs no column at all, and `count_distinct`, `min`, and `max` are meaningful over text
 * and temporal columns too, so only the arithmetic aggregates are restricted.
 */
const NUMERIC_ONLY_AGGREGATES = new Set(['sum', 'avg', 'median']);

/**
 * Creates a metric.
 *
 * Metric *evaluation* needs the analytical engine, but its definition is metadata, so creation is
 * complete here. Evaluating a stored definition happens when a consumer requests its value.
 */
export const handleCreateMetric: ActionHandler<CreateMetricInput> = (workspace, payload) => {
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

  const metric: Metric = {
    id: createEntityId(ID_PREFIX.metric),
    datasetId: dataset.value.id,
    name,
    aggregate: payload.aggregate,
    ...(payload.columnId === undefined ? {} : { columnId: payload.columnId }),
    filters: payload.filters ?? [],
    ...(payload.format === undefined ? {} : { format: payload.format }),
  };

  return ok({
    workspace: { ...workspace, metrics: { ...workspace.metrics, [metric.id]: metric } },
    changedEntityIds: [metric.id],
    summary: `Created ${metric.aggregate} metric '${metric.name}'.`,
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
