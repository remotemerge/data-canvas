import { useMemo, useState } from 'react';
import { placeNewVisualization } from '@/application/layout/place-visualization.ts';
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

const CHART_KINDS = VISUALIZATION_KINDS.filter((kind) => kind !== 'table');

/** A column offered by the builder, tagged with the dataset it came from so provenance stays visible. */
interface ScopedColumn {
  column: Column;
  dataset: Dataset;
}

/** Groups scoped columns by dataset, preserving the anchor-first order the caller supplied. */
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
  const layoutItems = workspace.layout.items;
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

  // Columns from datasets joinable to the anchor become selectable, anchor first. The same
  // reachability helper the handler validates against, so the form cannot offer an unreachable
  // column that the dispatcher would then reject.
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

  // A histogram bins its x column, so it offers numeric and temporal columns rather than the
  // dimensions the grouped kinds accept.
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
   * A temporal dimension on a series chart is bucketed rather than grouped by raw value.
   *
   * Grouping by a raw timestamp makes one group per distinct instant, which for daily data over a
   * year is hundreds of marks packed into a few hundred pixels. Binning states the granularity
   * explicitly, and it is what lets the sampling policy widen the unit when the span outgrows the
   * plot — an unbinned dimension gives it nothing to widen.
   *
   * Day is the floor, never the final answer: the policy coarsens to weeks or months as needed, and
   * a short span stays daily.
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

  // The title state holds a user override only, so an untouched field keeps tracking the binding
  // rather than freezing whatever the first column choice suggested.
  const suggestedTitle = suggestVisualizationTitle({
    kind,
    ...(measureName === undefined ? {} : { measureName }),
    ...(dimensionName === undefined ? {} : { dimensionName }),
    // A box plot derives its own quantiles, so naming an aggregate would describe a step it never runs.
    ...(kind === 'boxplot' ? {} : { aggregate }),
  });
  const effectiveTitle = title.trim() === '' ? suggestedTitle : title;

  const create = async () => {
    if (dataset === undefined || validation === null || !validation.ok) return;
    // Each distribution kind needs its own query shape: a histogram counts rows per bucket, a box
    // plot asks for a five-number summary, and the rest group as before.
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
              // A bucketed temporal dimension moves to `binnedDimensions`, which is the shape the
              // compiler bins on and the sampling policy widens.
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
    const visualizationId = result.value.changedEntityIds[0];
    if (visualizationId !== undefined) {
      const layout = await actions.updateLayout({
        items: placeNewVisualization(layoutItems, visualizationId, workspace.layout.columns),
      });
      if (!layout.ok) onError(layout.error);
    }
    setTitle('');
  };

  return (
    <section className="visualization-builder" aria-labelledby="visualization-builder-title">
      <div>
        <h2 id="visualization-builder-title">Add a view</h2>
        <p>Bind a dataset column to a chart.</p>
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
        {/* Empty means "use the suggestion", shown as the placeholder so the generated title is
            visible before creating. Typing overrides it; clearing the field returns to tracking. */}
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
            <small>Temporal columns bin by month.</small>
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
        <label>
          Dimension
          <select value={x} onChange={(event) => setX(event.target.value)}>
            <option value="">Choose</option>
            {groupByDataset(dimensionColumns).map((group) => (
              // Grouped by source dataset so a column's provenance is legible when a chart spans a
              // join and two datasets contribute similarly named columns.
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
      )}
      {/* A histogram's measure is the bucket count, so offering one would let it contradict the chart. */}
      {kind === 'histogram' ? null : (
        <label>
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
        </label>
      )}
      {/* A box plot computes its own quantiles, so an aggregate choice would have nothing to act on. */}
      {kind === 'histogram' || kind === 'boxplot' ? null : (
        <label>
          Aggregate
          <select value={aggregate} onChange={(event) => setAggregate(event.target.value as AggregateFunction)}>
            {['sum', 'avg', 'min', 'max', 'median', 'stddev'].map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
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
