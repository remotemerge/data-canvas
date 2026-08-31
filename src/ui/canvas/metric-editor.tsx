import { useState } from 'react';
import { TEMPORAL_UNITS } from '@/domain/analysis/bin-strategy.ts';
import type { TemporalUnit } from '@/domain/analysis/bin-strategy.ts';
import type { Metric } from '@/domain/metric/metric.ts';
import { METRIC_DIRECTIONS, TIME_COMPARISON_OUTPUTS } from '@/domain/metric/metric-modifier.ts';
import type { MetricDirection, MetricModifier, TimeComparisonOutput } from '@/domain/metric/metric-modifier.ts';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import { useActions } from '@/state/use-actions.ts';
import { useWorkspace } from '@/state/use-workspace.ts';

type ModifierKind = MetricModifier['kind'];

const MODIFIER_LABEL: Readonly<Record<ModifierKind, string>> = {
  none: 'Plain aggregate',
  percentOfTotal: 'Percent of total',
  runningTotal: 'Running total',
  timeComparison: 'Compare to earlier period',
};

const DIRECTION_LABEL: Readonly<Record<MetricDirection, string>> = {
  increaseIsGood: 'Higher is better',
  increaseIsBad: 'Lower is better',
  neutral: 'Neither',
};

// Edits a metric's modifier and delta presentation.
export const MetricEditor = ({
  metric,
  onError,
}: {
  metric: Metric;
  onError(error: DomainError | null): void;
}): React.JSX.Element => {
  const workspace = useWorkspace((state) => state.workspace);
  const { updateMetric } = useActions();
  const dataset = workspace.datasets[metric.datasetId];
  const [kind, setKind] = useState<ModifierKind>(metric.modifier?.kind ?? 'none');
  const [orderBy, setOrderBy] = useState(metric.modifier?.kind === 'runningTotal' ? metric.modifier.orderBy : '');
  const [dateColumnId, setDateColumnId] = useState(
    metric.modifier?.kind === 'timeComparison' ? metric.modifier.dateColumnId : '',
  );
  const [unit, setUnit] = useState<TemporalUnit>(
    metric.modifier?.kind === 'timeComparison' ? metric.modifier.unit : 'month',
  );
  const [offset, setOffset] = useState(metric.modifier?.kind === 'timeComparison' ? metric.modifier.offset : 1);
  const [output, setOutput] = useState<TimeComparisonOutput>(
    metric.modifier?.kind === 'timeComparison' ? metric.modifier.as : 'percentChange',
  );
  const [direction, setDirection] = useState<MetricDirection>(metric.format?.direction ?? 'neutral');

  const columns = dataset?.columns ?? [];
  const temporalColumns = columns.filter(
    (column) => column.logicalType === 'date' || column.logicalType === 'timestamp',
  );

  const buildModifier = (): MetricModifier | null => {
    if (kind === 'none') return { kind: 'none' };
    if (kind === 'percentOfTotal') return { kind: 'percentOfTotal' };
    if (kind === 'runningTotal') return orderBy === '' ? null : { kind: 'runningTotal', orderBy };

    return dateColumnId === '' ? null : { kind: 'timeComparison', dateColumnId, unit, offset, as: output };
  };

  const modifier = buildModifier();

  const save = (): void => {
    if (modifier === null) return;

    // Percent change is a ratio; difference is a level, so format follows the modifier.
    const percent = modifier.kind === 'timeComparison' && modifier.as === 'percentChange';
    const comparison = modifier.kind === 'timeComparison' && modifier.as !== 'absolute';

    void updateMetric({
      metricId: metric.id,
      modifier,
      format: {
        ...metric.format,
        style: percent || modifier.kind === 'percentOfTotal' ? 'percent' : (metric.format?.style ?? 'plain'),
        ...(comparison ? { showSign: true } : {}),
        direction,
      },
    }).then((result) => onError(result.ok ? null : result.error));
  };

  return (
    <section className="metric-editor" aria-labelledby={`metric-editor-${metric.id}`}>
      <h3 id={`metric-editor-${metric.id}`}>{metric.name}</h3>

      <label>
        Calculation
        <select value={kind} onChange={(event) => setKind(event.target.value as ModifierKind)}>
          {(Object.keys(MODIFIER_LABEL) as ModifierKind[]).map((item) => (
            <option key={item} value={item}>
              {MODIFIER_LABEL[item]}
            </option>
          ))}
        </select>
      </label>

      {kind === 'runningTotal' ? (
        <label>
          Order by
          <select value={orderBy} onChange={(event) => setOrderBy(event.target.value)}>
            <option value="">Choose</option>
            {columns.map((column) => (
              <option key={column.id} value={column.id}>
                {column.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {kind === 'timeComparison' ? (
        <>
          <label>
            Date column
            <select value={dateColumnId} onChange={(event) => setDateColumnId(event.target.value)}>
              <option value="">Choose</option>
              {temporalColumns.map((column) => (
                <option key={column.id} value={column.id}>
                  {column.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Period
            <select value={unit} onChange={(event) => setUnit(event.target.value as TemporalUnit)}>
              {TEMPORAL_UNITS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label>
            Periods back
            <input
              type="number"
              min={1}
              max={104}
              value={offset}
              onChange={(event) => setOffset(Math.trunc(Number(event.target.value)) || 1)}
            />
          </label>
          <label>
            Show
            <select value={output} onChange={(event) => setOutput(event.target.value as TimeComparisonOutput)}>
              {TIME_COMPARISON_OUTPUTS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <small>Empty periods count as zero, so gaps do not shift the comparison.</small>
        </>
      ) : null}

      <label>
        When this rises
        <select value={direction} onChange={(event) => setDirection(event.target.value as MetricDirection)}>
          {METRIC_DIRECTIONS.map((item) => (
            <option key={item} value={item}>
              {DIRECTION_LABEL[item]}
            </option>
          ))}
        </select>
      </label>

      <button type="button" disabled={modifier === null} onClick={save}>
        Save metric
      </button>
    </section>
  );
};
