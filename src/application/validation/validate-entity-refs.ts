import type { Column, Dataset } from '@/domain/dataset/dataset.ts';
import type { DerivedColumn } from '@/domain/dataset/derived-column.ts';
import type { Filter } from '@/domain/filter/filter.ts';
import type { Metric } from '@/domain/metric/metric.ts';
import type { Visualization } from '@/domain/visualization/visualization.ts';
import type { Annotation } from '@/domain/annotation/annotation.ts';
import type { Workspace } from '@/domain/workspace/workspace.ts';
import { domainError } from '@/shared/errors/domain-error.ts';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import type { EntityId } from '@/shared/ids/entity-id.ts';
import { err, ok } from '@/shared/result/result.ts';
import type { Result } from '@/shared/result/result.ts';

// Resolve entity IDs before handlers mutate state or build queries.

export const resolveDataset = (workspace: Workspace, datasetId: EntityId): Result<Dataset, DomainError> => {
  const dataset = workspace.datasets[datasetId];

  return dataset === undefined
    ? err(
        domainError('DATASET_NOT_FOUND', `No dataset with id '${datasetId}' exists in this workspace.`, { datasetId }),
      )
    : ok(dataset);
};

export const resolveColumn = (dataset: Dataset, columnId: EntityId): Result<Column, DomainError> => {
  const column = dataset.columns.find((candidate) => candidate.id === columnId);

  return column === undefined
    ? err(
        domainError('COLUMN_NOT_FOUND', `No column with id '${columnId}' exists in dataset '${dataset.name}'.`, {
          datasetId: dataset.id,
          columnId,
        }),
      )
    : ok(column);
};

// Resolves the common dataset-and-column reference pair.
export const resolveDatasetColumn = (
  workspace: Workspace,
  datasetId: EntityId,
  columnId: EntityId,
): Result<{ dataset: Dataset; column: Column }, DomainError> => {
  const dataset = resolveDataset(workspace, datasetId);

  if (!dataset.ok) return dataset;

  const column = resolveColumn(dataset.value, columnId);

  return column.ok ? ok({ dataset: dataset.value, column: column.value }) : column;
};

export const resolveVisualization = (
  workspace: Workspace,
  visualizationId: EntityId,
): Result<Visualization, DomainError> => {
  const visualization = workspace.visualizations[visualizationId];

  return visualization === undefined
    ? err(
        domainError('VISUALIZATION_NOT_FOUND', `No visualization with id '${visualizationId}' exists.`, {
          visualizationId,
        }),
      )
    : ok(visualization);
};

export const resolveFilter = (workspace: Workspace, filterId: EntityId): Result<Filter, DomainError> => {
  const filter = workspace.filters[filterId];

  return filter === undefined
    ? err(domainError('FILTER_NOT_FOUND', `No filter with id '${filterId}' exists.`, { filterId }))
    : ok(filter);
};

// Metrics and annotations share UNSUPPORTED_OPERATION in the public error-code union.

export const resolveMetric = (workspace: Workspace, metricId: EntityId): Result<Metric, DomainError> => {
  const metric = workspace.metrics[metricId];

  return metric === undefined
    ? err(domainError('UNSUPPORTED_OPERATION', `No metric with id '${metricId}' exists.`, { metricId }))
    : ok(metric);
};

export const resolveDerivedColumn = (
  workspace: Workspace,
  derivedColumnId: EntityId,
): Result<DerivedColumn, DomainError> => {
  const derived = workspace.derivedColumns[derivedColumnId];

  return derived === undefined
    ? err(
        domainError('COLUMN_NOT_FOUND', `No derived column with id '${derivedColumnId}' exists.`, {
          derivedColumnId,
        }),
      )
    : ok(derived);
};

export const resolveAnnotation = (workspace: Workspace, annotationId: EntityId): Result<Annotation, DomainError> => {
  const annotation = workspace.annotations[annotationId];

  return annotation === undefined
    ? err(domainError('UNSUPPORTED_OPERATION', `No annotation with id '${annotationId}' exists.`, { annotationId }))
    : ok(annotation);
};
