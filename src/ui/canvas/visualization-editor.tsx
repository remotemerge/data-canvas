import { useMemo, useState } from 'react';
import { reachableDatasets } from '@/application/relationships/related-datasets.ts';
import { validateVisualization } from '@/application/validation/validate-visualization.ts';
import { MAX_BIN_COUNT, MIN_BIN_COUNT } from '@/domain/analysis/bin-strategy.ts';
import type { BinStrategy } from '@/domain/analysis/bin-strategy.ts';
import type { Column, Dataset } from '@/domain/dataset/dataset.ts';
import { isTemporalType } from '@/domain/logical-type.ts';
import type { AggregateFunction } from '@/domain/metric/metric.ts';
import {
  VISUALIZATION_KINDS,
  type VisualBinding,
  type Visualization,
  type VisualizationKind,
} from '@/domain/visualization/visualization.ts';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import { useActions } from '@/state/use-actions.ts';
import { useWorkspace } from '@/state/use-workspace.ts';
import { FIELD_HINT } from '@/ui/canvas/field-hints.ts';

const CHART_KINDS = VISUALIZATION_KINDS.filter((kind) => kind !== 'table');

const AGGREGATES: readonly AggregateFunction[] = ['sum', 'avg', 'min', 'max', 'median', 'stddev'] as const;

// Column offered by the editor with its source dataset.
interface ScopedColumn {
  column: Column;
  dataset: Dataset;
}

// Groups columns by dataset so joined columns keep their provenance in the picker.
const groupByDataset = (columns: readonly ScopedColumn[]): { dataset: Dataset; columns: Column[] }[] => {
  const groups: { dataset: Dataset; columns: Column[] }[] = [];

  for (const scoped of columns) {
    const existing = groups.find((group) => group.dataset.id === scoped.dataset.id);

    if (existing === undefined) groups.push({ dataset: scoped.dataset, columns: [scoped.column] });
    else existing.columns.push(scoped.column);
  }

  return groups;
};

// Reads the aggregate an existing query applies to its first measure.
const currentAggregate = (visualization: Visualization): AggregateFunction => {
  const aggregate = visualization.query.measures[0]?.aggregate;

  return aggregate !== undefined && (AGGREGATES as readonly string[]).includes(aggregate)
    ? (aggregate as AggregateFunction)
    : 'sum';
};

// Reads the bucket count of an existing equal-width binding.
const currentBinCount = (visualization: Visualization): number =>
  visualization.binding.binX?.kind === 'equalWidth' ? visualization.binding.binX.binCount : 20;

/**
 * Rebinds an existing visualization.
 *
 * Chart cards previously exposed only link mode, size, and removal, so a person could not change what
 * an existing chart plots without deleting and rebuilding it — narrower than the `update_visualization`
 * capability agents already hold. This dispatches the same action so both paths stay equivalent.
 */
export const VisualizationEditor = ({
  visualization,
  onError,
  onDone,
}: {
  visualization: Visualization;
  onError: (error: DomainError) => void;
  onDone: () => void;
}): React.JSX.Element => {
  const workspace = useWorkspace((state) => state.workspace);
  const actions = useActions();

  const [kind, setKind] = useState<VisualizationKind>(visualization.kind);
  const [title, setTitle] = useState(visualization.title);
  const [x, setX] = useState(visualization.binding.x ?? '');
  const [y, setY] = useState(visualization.binding.y?.[0] ?? '');
  const [aggregate, setAggregate] = useState<AggregateFunction>(currentAggregate(visualization));
  const [binCount, setBinCount] = useState(currentBinCount(visualization));

  const dataset = workspace.datasets[visualization.datasetId];

  const related = useMemo(
    () => (dataset === undefined ? [] : reachableDatasets(workspace, dataset.id)),
    [workspace, dataset],
  );

  const scopedColumns = useMemo<ScopedColumn[]>(
    () =>
      dataset === undefined
        ? []
        : [dataset, ...related].flatMap((source) => source.columns.map((column) => ({ column, dataset: source }))),
    [dataset, related],
  );

  const numericColumns = scopedColumns.filter((scoped) => scoped.column.logicalType === 'number');

  // Histograms bin x, so they offer numeric and temporal columns.
  const binnable = scopedColumns.filter(
    (scoped) => scoped.column.logicalType === 'number' || isTemporalType(scoped.column.logicalType),
  );

  const histogramColumn = binnable.find((scoped) => scoped.column.id === x)?.column;
  const temporalBin = histogramColumn !== undefined && histogramColumn.logicalType !== 'number';
  const binStrategy: BinStrategy = temporalBin ? { kind: 'temporal', unit: 'month' } : { kind: 'equalWidth', binCount };

  const validationMeasure = y === '' ? numericColumns[0]?.column.id : y;
  const dimensionColumns = scopedColumns.filter((scoped) => {
    if (dataset === undefined || kind === 'kpi' || validationMeasure === undefined) return false;

    return validateVisualization(dataset, kind, { x: scoped.column.id, y: [validationMeasure] }, related).ok;
  });

  // Raw timestamps produce one group per instant, so temporal dimensions bucket before querying.
  const seriesDimension = dimensionColumns.find((scoped) => scoped.column.id === x)?.column;
  const temporalDimension = seriesDimension !== undefined && isTemporalType(seriesDimension.logicalType);
  const dimensionBin: BinStrategy = { kind: 'temporal', unit: 'day' };

  const binding: VisualBinding =
    kind === 'kpi'
      ? { y: y === '' ? [] : [y] }
      : kind === 'histogram'
        ? x === ''
          ? {}
          : { x, binX: binStrategy }
        : {
            ...(x === '' ? {} : { x }),
            ...(y === '' ? {} : { y: [y] }),
            ...(temporalDimension ? { binX: dimensionBin } : {}),
          };

  const validation = dataset === undefined ? null : validateVisualization(dataset, kind, binding, related);
  const titled = title.trim() !== '';

  const save = async (): Promise<void> => {
    if (dataset === undefined || validation === null || !validation.ok || !titled) return;

    // Mirrors the builder's query shapes so an edited chart matches an equivalent new one.
    const query =
      kind === 'histogram'
        ? {
            datasetId: dataset.id,
            dimensions: [],
            ...(x === '' ? {} : { binnedDimensions: [{ columnId: x, strategy: binStrategy }] }),
            measures: [{ aggregate: 'count' as const }],
            filters: [],
          }
        : kind === 'boxplot'
          ? {
              datasetId: dataset.id,
              dimensions: [],
              measures: [],
              ...(y === '' ? {} : { distribution: { columnId: y, ...(x === '' ? {} : { categoryColumnId: x }) } }),
              filters: [],
            }
          : {
              datasetId: dataset.id,
              dimensions: x === '' || temporalDimension ? [] : [x],
              ...(x === '' || !temporalDimension
                ? {}
                : { binnedDimensions: [{ columnId: x, strategy: dimensionBin }] }),
              measures: y === '' ? [] : [{ columnId: y, aggregate }],
              filters: [],
            };

    const result = await actions.updateVisualization({
      visualizationId: visualization.id,
      title: title.trim(),
      kind,
      binding,
      query,
    });

    if (!result.ok) {
      onError(result.error);

      return;
    }

    onDone();
  };

  return (
    <section className="visualization-editor" aria-labelledby={`visualization-editor-${visualization.id}`}>
      <h4 id={`visualization-editor-${visualization.id}`}>Edit view</h4>

      <label>
        Chart
        <select
          value={kind}
          onChange={(event) => {
            setKind(event.target.value as VisualizationKind);
          }}
        >
          {CHART_KINDS.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </label>

      <label>
        Title
        <input value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} />
      </label>

      {kind === 'histogram' ? (
        <>
          <label>
            Column to bin
            <select value={x} onChange={(event) => setX(event.target.value)}>
              <option value="">Choose</option>
              {groupByDataset(binnable).map((group) => (
                <optgroup key={group.dataset.id} label={group.dataset.name}>
                  {group.columns.map((column) => (
                    <option key={column.id} value={column.id}>
                      {column.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          {temporalBin ? (
            <small>Date and timestamp values are grouped by month.</small>
          ) : (
            <label>
              Buckets
              <input
                type="number"
                min={MIN_BIN_COUNT}
                max={MAX_BIN_COUNT}
                value={binCount}
                onChange={(event) =>
                  setBinCount(
                    Math.min(
                      Math.max(Math.trunc(Number(event.target.value)) || MIN_BIN_COUNT, MIN_BIN_COUNT),
                      MAX_BIN_COUNT,
                    ),
                  )
                }
              />
            </label>
          )}
        </>
      ) : kind === 'kpi' ? null : (
        <label title={FIELD_HINT.dimension}>
          Dimension
          <select value={x} onChange={(event) => setX(event.target.value)}>
            <option value="">Choose</option>
            {groupByDataset(dimensionColumns).map((group) => (
              <optgroup key={group.dataset.id} label={group.dataset.name}>
                {group.columns.map((column) => (
                  <option key={column.id} value={column.id}>
                    {column.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <small className="field-hint">{FIELD_HINT.dimension}</small>
        </label>
      )}

      {/* Histogram y is its bucket count, so it has no measure selector. */}
      {kind === 'histogram' ? null : (
        <label title={FIELD_HINT.measure}>
          Measure
          <select value={y} onChange={(event) => setY(event.target.value)}>
            <option value="">Choose</option>
            {groupByDataset(numericColumns).map((group) => (
              <optgroup key={group.dataset.id} label={group.dataset.name}>
                {group.columns.map((column) => (
                  <option key={column.id} value={column.id}>
                    {column.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <small className="field-hint">{FIELD_HINT.measure}</small>
        </label>
      )}

      {/* Box plots compute quantiles, so they have no aggregate selector. */}
      {kind === 'histogram' || kind === 'boxplot' ? null : (
        <label title={FIELD_HINT.aggregate}>
          Aggregate
          <select value={aggregate} onChange={(event) => setAggregate(event.target.value as AggregateFunction)}>
            {AGGREGATES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <small className="field-hint">{FIELD_HINT.aggregate}</small>
        </label>
      )}

      <button type="button" disabled={!titled || validation === null || !validation.ok} onClick={() => void save()}>
        Save view
      </button>

      {validation !== null && !validation.ok ? (
        <p className="visualization-editor__hint">{validation.error.message}</p>
      ) : null}
    </section>
  );
};
