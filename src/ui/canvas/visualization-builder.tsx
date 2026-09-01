import { useMemo, useState } from 'react';
import { suggestVisualizationTitle } from '@/application/layout/visualization-title.ts';
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
  type VisualizationKind,
} from '@/domain/visualization/visualization.ts';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import { useActions } from '@/state/use-actions.ts';
import { useWorkspace } from '@/state/use-workspace.ts';
import { FIELD_HINT } from '@/ui/canvas/field-hints.ts';

const CHART_KINDS = VISUALIZATION_KINDS.filter((kind) => kind !== 'table');

// Column offered by the builder with its source dataset.
interface ScopedColumn {
  column: Column;
  dataset: Dataset;
}

// Groups columns by dataset while preserving caller order.
const groupByDataset = (columns: readonly ScopedColumn[]): { dataset: Dataset; columns: Column[] }[] => {
  const groups: { dataset: Dataset; columns: Column[] }[] = [];

  for (const scoped of columns) {
    const existing = groups.find((group) => group.dataset.id === scoped.dataset.id);

    if (existing === undefined) groups.push({ dataset: scoped.dataset, columns: [scoped.column] });
    else existing.columns.push(scoped.column);
  }

  return groups;
};

export const VisualizationBuilder = ({ onError }: { onError: (error: DomainError) => void }) => {
  const workspace = useWorkspace((state) => state.workspace);
  const datasets = workspace.datasets;
  const actions = useActions();
  const datasetList = useMemo(
    () => Object.values(datasets).filter((item) => item.importStatus === 'ready'),
    [datasets],
  );
  const [datasetId, setDatasetId] = useState('');
  const [kind, setKind] = useState<VisualizationKind>('bar');
  const [title, setTitle] = useState('');
  const [x, setX] = useState('');
  const [y, setY] = useState('');
  const [aggregate, setAggregate] = useState<AggregateFunction>('sum');
  const [binCount, setBinCount] = useState(20);
  const dataset = datasets[datasetId];

  // Offer columns from datasets reachable from the anchor.
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
    (scoped) =>
      scoped.column.logicalType === 'number' ||
      scoped.column.logicalType === 'date' ||
      scoped.column.logicalType === 'timestamp',
  );

  const histogramColumn = binnable.find((scoped) => scoped.column.id === x)?.column;
  const temporalBin = histogramColumn !== undefined && histogramColumn.logicalType !== 'number';
  const binStrategy: BinStrategy = temporalBin ? { kind: 'temporal', unit: 'month' } : { kind: 'equalWidth', binCount };

  const validationMeasure = y === '' ? numericColumns[0]?.column.id : y;
  const dimensionColumns = scopedColumns.filter((scoped) => {
    if (dataset === undefined || kind === 'kpi' || validationMeasure === undefined) return false;
    return validateVisualization(dataset, kind, { x: scoped.column.id, y: [validationMeasure] }, related).ok;
  });

  /*
   * Bucket temporal dimensions before querying. Raw timestamps can produce one group per instant,
   * leaving the chart with too many marks. The sampling policy can widen the bucket later.
   */
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

  const columnName = (columnId: string): string | undefined =>
    scopedColumns.find((scoped) => scoped.column.id === columnId)?.column.name;
  const measureName = columnName(y);
  const dimensionName = columnName(x);

  // Keep an empty override tied to the current suggestion.
  const suggestedTitle = suggestVisualizationTitle({
    kind,
    ...(measureName === undefined ? {} : { measureName }),
    ...(dimensionName === undefined ? {} : { dimensionName }),
    // Box plots compute quantiles themselves; they do not use an aggregate choice.
    ...(kind === 'boxplot' ? {} : { aggregate }),
  });
  const effectiveTitle = title.trim() === '' ? suggestedTitle : title;

  const create = async () => {
    if (dataset === undefined || validation === null || !validation.ok) return;
    // Distribution kinds use dedicated query shapes.
    const query =
      kind === 'histogram'
        ? {
            datasetId,
            dimensions: [],
            ...(x === '' ? {} : { binnedDimensions: [{ columnId: x, strategy: binStrategy }] }),
            measures: [{ aggregate: 'count' as const }],
            filters: [],
          }
        : kind === 'boxplot'
          ? {
              datasetId,
              dimensions: [],
              measures: [],
              ...(y === '' ? {} : { distribution: { columnId: y, ...(x === '' ? {} : { categoryColumnId: x }) } }),
              filters: [],
            }
          : {
              datasetId,
              // Binned dimensions use the compiler's `binnedDimensions` shape.
              dimensions: x === '' || temporalDimension ? [] : [x],
              ...(x === '' || !temporalDimension
                ? {}
                : { binnedDimensions: [{ columnId: x, strategy: dimensionBin }] }),
              measures: y === '' ? [] : [{ columnId: y, aggregate }],
              filters: [],
            };

    const result = await actions.createVisualization({
      datasetId,
      title: effectiveTitle,
      kind,
      binding,
      query,
    });
    if (!result.ok) {
      onError(result.error);
      return;
    }
    setTitle('');
  };

  return (
    <section className="visualization-builder" aria-labelledby="visualization-builder-title">
      <div>
        <h2 id="visualization-builder-title">Add a view</h2>
        <p>Choose a dataset and the columns to chart.</p>
      </div>
      <label>
        Dataset
        <select
          value={datasetId}
          onChange={(event) => {
            setDatasetId(event.target.value);
            setX('');
            setY('');
          }}
        >
          <option value="">Choose</option>
          {datasetList.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Chart
        <select
          value={kind}
          onChange={(event) => {
            setKind(event.target.value as VisualizationKind);
            setX('');
            setY('');
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
        {/* Empty uses the generated suggestion as a placeholder; text overrides it. */}
        <input
          value={title}
          maxLength={120}
          placeholder={suggestedTitle}
          onChange={(event) => setTitle(event.target.value)}
        />
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
              // Group by dataset so provenance stays visible for joined columns.
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
            {['sum', 'avg', 'min', 'max', 'median', 'stddev'].map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
          <small className="field-hint">{FIELD_HINT.aggregate}</small>
        </label>
      )}
      <button
        type="button"
        disabled={effectiveTitle.trim() === '' || validation === null || !validation.ok}
        onClick={() => void create()}
      >
        Create view
      </button>
      {validation !== null && !validation.ok ? (
        <p className="visualization-builder__hint">{validation.error.message}</p>
      ) : null}
    </section>
  );
};
