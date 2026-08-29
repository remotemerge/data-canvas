import { validateBinStrategy } from '@/application/validation/validate-bin-strategy.ts';
import type { Column, Dataset } from '@/domain/dataset/dataset.ts';
import { isNumericType, isTemporalType, isTextType } from '@/domain/logical-type.ts';
import type { VisualBinding, VisualizationKind } from '@/domain/visualization/visualization.ts';
import { domainError } from '@/shared/errors/domain-error.ts';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import type { EntityId } from '@/shared/ids/entity-id.ts';
import { err, ok } from '@/shared/result/result.ts';
import type { Result } from '@/shared/result/result.ts';
import { resolveColumn } from '@/application/validation/validate-entity-refs.ts';

/**
 * Upper bound on measures bound to one chart. Beyond this the chart is unreadable and the series
 * count starts to matter for render cost, so it is rejected rather than silently truncated.
 */
export const MAX_BOUND_MEASURES = 12;

/*
 * Per-kind binding rules.
 *
 * Messages are written so an agent can self-correct without another round trip: they state the
 * requirement and the actual column type that violated it. Column display names are safe to
 * include; column values are not, and never appear here.
 */

const missingChannel = (kind: VisualizationKind, channel: string, requirement: string): DomainError =>
  domainError('INCOMPATIBLE_COLUMN', `${kind} requires ${requirement}; '${channel}' is not bound.`, { kind, channel });

const wrongType = (kind: VisualizationKind, channel: string, column: Column, requirement: string): DomainError =>
  domainError(
    'INCOMPATIBLE_COLUMN',
    `${kind} requires ${requirement}; column '${column.name}' is ${column.logicalType}.`,
    { kind, channel, columnId: column.id, logicalType: column.logicalType },
  );

/**
 * Resolves every bound channel so an unknown column ID cannot survive into a stored visualization.
 *
 * `related` carries datasets reachable from the anchor through a relationship. A chart may bind a
 * dimension from one dataset and a measure from another, so resolution spans them — but only over
 * datasets the caller has already established are joinable, never the whole workspace.
 */
const resolveBoundColumns = (
  dataset: Dataset,
  binding: VisualBinding,
  related: readonly Dataset[],
): Result<Map<EntityId, Column>, DomainError> => {
  const referenced: EntityId[] = [
    ...(binding.x === undefined ? [] : [binding.x]),
    ...(binding.y ?? []),
    ...(binding.series === undefined ? [] : [binding.series]),
    ...(binding.color === undefined ? [] : [binding.color]),
    ...(binding.size === undefined ? [] : [binding.size]),
    ...(binding.tooltip ?? []),
  ];

  const resolved = new Map<EntityId, Column>();

  for (const columnId of referenced) {
    if (resolved.has(columnId)) continue;

    const fromRelated = related.flatMap((candidate) => candidate.columns).find((column) => column.id === columnId);

    if (fromRelated !== undefined) {
      resolved.set(columnId, fromRelated);
      continue;
    }

    // Falls back to the anchor last, so its error message names the anchor — the dataset the caller
    // actually chose — rather than whichever related dataset happened to be checked first.
    const column = resolveColumn(dataset, columnId);

    if (!column.ok) return column;

    resolved.set(columnId, column.value);
  }

  return ok(resolved);
};

const measureIds = (binding: VisualBinding): EntityId[] => binding.y ?? [];

const validateMeasures = (
  kind: VisualizationKind,
  binding: VisualBinding,
  columns: Map<EntityId, Column>,
): Result<void, DomainError> => {
  const measures = measureIds(binding);

  if (measures.length === 0) return err(missingChannel(kind, 'y', 'at least one measure'));

  if (measures.length > MAX_BOUND_MEASURES) {
    return err(
      domainError('RESULT_LIMIT_EXCEEDED', `${kind} accepts at most ${MAX_BOUND_MEASURES} measures.`, {
        kind,
        maxMeasures: MAX_BOUND_MEASURES,
      }),
    );
  }

  for (const measureId of measures) {
    const column = columns.get(measureId);

    if (column !== undefined && !isNumericType(column.logicalType)) {
      return err(wrongType(kind, 'y', column, 'numeric measures'));
    }
  }

  return ok(undefined);
};

const validateSeriesKind = (
  kind: VisualizationKind,
  binding: VisualBinding,
  columns: Map<EntityId, Column>,
): Result<void, DomainError> => {
  if (binding.x === undefined) return err(missingChannel(kind, 'x', 'an x dimension'));

  const x = columns.get(binding.x);

  // `line` and `area` imply progression along x, so an unordered text dimension misrepresents the
  // data. `bar` has no such implication and accepts categories.
  if (x !== undefined && kind !== 'bar' && !isTemporalType(x.logicalType) && !isNumericType(x.logicalType)) {
    return err(wrongType(kind, 'x', x, 'a temporal or ordered numeric x'));
  }

  return validateMeasures(kind, binding, columns);
};

const validateScatter = (binding: VisualBinding, columns: Map<EntityId, Column>): Result<void, DomainError> => {
  if (binding.x === undefined) return err(missingChannel('scatter', 'x', 'numeric x and y'));

  const x = columns.get(binding.x);

  if (x !== undefined && !isNumericType(x.logicalType)) {
    return err(wrongType('scatter', 'x', x, 'numeric x and y'));
  }

  const measures = measureIds(binding);

  if (measures.length !== 1) {
    return err(
      domainError('INCOMPATIBLE_COLUMN', `scatter requires exactly one y measure; ${measures.length} are bound.`, {
        kind: 'scatter',
        channel: 'y',
      }),
    );
  }

  const [measureId] = measures as [EntityId];
  const y = columns.get(measureId);

  return y !== undefined && !isNumericType(y.logicalType)
    ? err(wrongType('scatter', 'y', y, 'numeric x and y'))
    : ok(undefined);
};

const validateDonut = (binding: VisualBinding, columns: Map<EntityId, Column>): Result<void, DomainError> => {
  if (binding.x === undefined) return err(missingChannel('donut', 'x', 'one category dimension and one measure'));

  const dimension = columns.get(binding.x);

  if (dimension !== undefined && !isTextType(dimension.logicalType)) {
    return err(wrongType('donut', 'x', dimension, 'a string or category dimension'));
  }

  const measures = measureIds(binding);

  if (measures.length !== 1) {
    return err(
      domainError('INCOMPATIBLE_COLUMN', `donut requires exactly one measure; ${measures.length} are bound.`, {
        kind: 'donut',
        channel: 'y',
      }),
    );
  }

  const [measureId] = measures as [EntityId];
  const measure = columns.get(measureId);

  return measure !== undefined && !isNumericType(measure.logicalType)
    ? err(wrongType('donut', 'y', measure, 'a numeric measure'))
    : ok(undefined);
};

const validateKpi = (binding: VisualBinding, columns: Map<EntityId, Column>): Result<void, DomainError> => {
  const measures = measureIds(binding);

  if (measures.length !== 1) {
    return err(
      domainError('INCOMPATIBLE_COLUMN', `kpi requires exactly one measure; ${measures.length} are bound.`, {
        kind: 'kpi',
        channel: 'y',
      }),
    );
  }

  if (binding.x !== undefined || binding.series !== undefined) {
    return err(
      domainError('UNSUPPORTED_OPERATION', 'kpi shows a single value and accepts no dimension.', { kind: 'kpi' }),
    );
  }

  const [measureId] = measures as [EntityId];
  const measure = columns.get(measureId);

  return measure !== undefined && !isNumericType(measure.logicalType)
    ? err(wrongType('kpi', 'y', measure, 'a numeric measure'))
    : ok(undefined);
};

const validateTable = (binding: VisualBinding, columns: Map<EntityId, Column>): Result<void, DomainError> =>
  columns.size === 0 && binding.x === undefined
    ? err(missingChannel('table', 'x', 'at least one bound column'))
    : ok(undefined);

/**
 * Upper bound on box plots in one chart.
 *
 * A box plot with hundreds of boxes is unreadable, and each box is a separate quantile computation,
 * so the limit protects legibility and query cost together.
 */
export const MAX_BOXPLOT_CATEGORIES = 50;

/**
 * A histogram bins one continuous column and counts the rows in each bucket.
 *
 * The measure comes from the bin, so `y` stays unbound: requiring a measure would invite a caller
 * to bind one that contradicts the count the histogram actually shows.
 */
const validateHistogram = (binding: VisualBinding, columns: Map<EntityId, Column>): Result<void, DomainError> => {
  if (binding.x === undefined) {
    return err(missingChannel('histogram', 'x', 'one numeric or temporal column to bin'));
  }

  const column = columns.get(binding.x);

  if (column !== undefined && !isNumericType(column.logicalType) && !isTemporalType(column.logicalType)) {
    return err(wrongType('histogram', 'x', column, 'a numeric or temporal column'));
  }

  if (binding.binX === undefined) {
    return err(
      domainError('UNSUPPORTED_OPERATION', 'histogram requires a bin strategy on its x column.', {
        kind: 'histogram',
        channel: 'binX',
      }),
    );
  }

  const strategy = validateBinStrategy(binding.binX);

  if (!strategy.ok) return strategy;

  // A temporal strategy on a numeric column, or the reverse, compiles to a function the column's
  // type cannot accept. Caught here so the message names the mismatch rather than DuckDB's error.
  if (column !== undefined) {
    const temporalStrategy = binding.binX.kind === 'temporal';

    if (temporalStrategy && !isTemporalType(column.logicalType)) {
      return err(wrongType('histogram', 'binX', column, 'a temporal column for temporal binning'));
    }

    if (!temporalStrategy && !isNumericType(column.logicalType)) {
      return err(wrongType('histogram', 'binX', column, 'a numeric column for numeric binning'));
    }
  }

  return ok(undefined);
};

/** A box plot summarizes one numeric measure, optionally split by a low-cardinality category. */
const validateBoxplot = (binding: VisualBinding, columns: Map<EntityId, Column>): Result<void, DomainError> => {
  const measures = measureIds(binding);

  if (measures.length !== 1) {
    return err(
      domainError(
        'INCOMPATIBLE_COLUMN',
        `boxplot requires exactly one numeric measure; ${measures.length} are bound.`,
        {
          kind: 'boxplot',
          channel: 'y',
        },
      ),
    );
  }

  const [measureId] = measures as [EntityId];
  const measure = columns.get(measureId);

  if (measure !== undefined && !isNumericType(measure.logicalType)) {
    return err(wrongType('boxplot', 'y', measure, 'a numeric measure'));
  }

  if (binding.x !== undefined) {
    const category = columns.get(binding.x);

    if (category !== undefined && isNumericType(category.logicalType)) {
      return err(wrongType('boxplot', 'x', category, 'a categorical or temporal split'));
    }
  }

  return ok(undefined);
};

/** A heatmap needs both axes and one measure, since colour encodes the cell's value. */
const validateHeatmap = (binding: VisualBinding, columns: Map<EntityId, Column>): Result<void, DomainError> => {
  if (binding.x === undefined) return err(missingChannel('heatmap', 'x', 'two dimensions and one measure'));
  if (binding.series === undefined) return err(missingChannel('heatmap', 'series', 'two dimensions and one measure'));

  const measures = measureIds(binding);

  if (measures.length !== 1) {
    return err(
      domainError('INCOMPATIBLE_COLUMN', `heatmap requires exactly one measure; ${measures.length} are bound.`, {
        kind: 'heatmap',
        channel: 'y',
      }),
    );
  }

  const [measureId] = measures as [EntityId];
  const measure = columns.get(measureId);

  if (measure !== undefined && !isNumericType(measure.logicalType)) {
    return err(wrongType('heatmap', 'y', measure, 'a numeric measure'));
  }

  for (const [channel, strategy] of [
    ['binX', binding.binX],
    ['binSeries', binding.binSeries],
  ] as const) {
    if (strategy === undefined) continue;

    const validated = validateBinStrategy(strategy);

    if (!validated.ok) return validated;

    const columnId = channel === 'binX' ? binding.x : binding.series;
    const column = columnId === undefined ? undefined : columns.get(columnId);

    if (column === undefined) continue;

    const temporalStrategy = strategy.kind === 'temporal';

    if (temporalStrategy && !isTemporalType(column.logicalType)) {
      return err(wrongType('heatmap', channel, column, 'a temporal column for temporal binning'));
    }

    if (!temporalStrategy && !isNumericType(column.logicalType)) {
      return err(wrongType('heatmap', channel, column, 'a numeric column for numeric binning'));
    }
  }

  return ok(undefined);
};

/**
 * Checks a visualization's binding against its kind and the available columns.
 *
 * Runs after the dataset is resolved. Resolves every referenced column itself, so callers do not
 * need a separate reference check for the binding. `related` is the datasets joinable to the anchor;
 * omitting it restricts the binding to the anchor's own columns.
 */
export const validateVisualization = (
  dataset: Dataset,
  kind: VisualizationKind,
  binding: VisualBinding,
  related: readonly Dataset[] = [],
): Result<void, DomainError> => {
  const columns = resolveBoundColumns(dataset, binding, related);

  if (!columns.ok) return columns;

  switch (kind) {
    case 'line':
    case 'area':
    case 'bar':
      return validateSeriesKind(kind, binding, columns.value);
    case 'scatter':
      return validateScatter(binding, columns.value);
    case 'donut':
      return validateDonut(binding, columns.value);
    case 'kpi':
      return validateKpi(binding, columns.value);
    case 'table':
      return validateTable(binding, columns.value);
    case 'histogram':
      return validateHistogram(binding, columns.value);
    case 'boxplot':
      return validateBoxplot(binding, columns.value);
    case 'heatmap':
      return validateHeatmap(binding, columns.value);
    default:
      return err(
        domainError('UNSUPPORTED_OPERATION', `Visualization kind '${kind as string}' is not supported.`, { kind }),
      );
  }
};
