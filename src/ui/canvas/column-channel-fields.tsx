import { MAX_BIN_COUNT, MIN_BIN_COUNT } from '@/domain/analysis/bin-strategy.ts';
import type { AggregateFunction } from '@/domain/metric/metric.ts';
import type { VisualizationKind } from '@/domain/visualization/visualization.ts';
import { FIELD_HINT } from '@/ui/canvas/field-hints.ts';
import { AGGREGATES, groupByDataset, type ScopedColumn } from '@/ui/canvas/visualization-form.ts';

// Options for one picker, grouped by dataset so provenance stays visible for joined columns.
const ColumnOptions = ({ columns }: { columns: readonly ScopedColumn[] }): React.JSX.Element => (
  <>
    <option value="">Choose</option>
    {groupByDataset(columns).map((group) => (
      <optgroup key={group.dataset.id} label={group.dataset.name}>
        {group.columns.map((column) => (
          <option key={column.id} value={column.id}>
            {column.name}
          </option>
        ))}
      </optgroup>
    ))}
  </>
);

/**
 * The column channel controls shared by the chart builder and the chart editor.
 *
 * A histogram bins a column instead of grouping by one, so it offers a bin column and bucket count.
 * A KPI has no dimension at all. Every other kind groups by a single dimension.
 */
export const DimensionField = ({
  kind,
  x,
  onXChange,
  binnable,
  dimensionColumns,
  temporalBin,
  binCount,
  onBinCountChange,
}: {
  kind: VisualizationKind;
  x: string;
  onXChange: (columnId: string) => void;
  binnable: readonly ScopedColumn[];
  dimensionColumns: readonly ScopedColumn[];
  temporalBin: boolean;
  binCount: number;
  onBinCountChange: (count: number) => void;
}): React.ReactNode => {
  if (kind === 'kpi') {
    return null;
  }

  if (kind === 'histogram') {
    return (
      <>
        <label>
          Column to bin{' '}
          <select value={x} onChange={(event) => onXChange(event.target.value)}>
            <ColumnOptions columns={binnable} />
          </select>
        </label>
        {temporalBin ? (
          <small>Date and timestamp values are grouped by month.</small>
        ) : (
          <label>
            Buckets{' '}
            <input
              type="number"
              min={MIN_BIN_COUNT}
              max={MAX_BIN_COUNT}
              value={binCount}
              onChange={(event) =>
                onBinCountChange(
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
    );
  }

  return (
    <label title={FIELD_HINT.dimension}>
      Dimension{' '}
      <select value={x} onChange={(event) => onXChange(event.target.value)}>
        <ColumnOptions columns={dimensionColumns} />
      </select>
    </label>
  );
};

// Histogram y is its bucket count, so it has no measure selector.
export const MeasureField = ({
  kind,
  y,
  onYChange,
  columns,
}: {
  kind: VisualizationKind;
  y: string;
  onYChange: (columnId: string) => void;
  columns: readonly ScopedColumn[];
}): React.ReactNode => {
  if (kind === 'histogram') {
    return null;
  }

  return (
    <label title={FIELD_HINT.measure}>
      Measure{' '}
      <select value={y} onChange={(event) => onYChange(event.target.value)}>
        <ColumnOptions columns={columns} />
      </select>
    </label>
  );
};

// Box plots compute quantiles themselves, so they have no aggregate selector.
export const AggregateField = ({
  kind,
  aggregate,
  onAggregateChange,
}: {
  kind: VisualizationKind;
  aggregate: AggregateFunction;
  onAggregateChange: (aggregate: AggregateFunction) => void;
}): React.ReactNode => {
  if (kind === 'histogram' || kind === 'boxplot') {
    return null;
  }

  return (
    <label title={FIELD_HINT.aggregate}>
      Aggregate{' '}
      <select value={aggregate} onChange={(event) => onAggregateChange(event.target.value as AggregateFunction)}>
        {AGGREGATES.map((item) => (
          <option key={item} value={item}>
            {item}
          </option>
        ))}
      </select>
    </label>
  );
};
