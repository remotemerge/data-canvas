import { useState } from 'react';
import type { AggregateFunction } from '@/domain/metric/metric.ts';
import type { Visualization, VisualizationKind } from '@/domain/visualization/visualization.ts';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import { useActions } from '@/state/use-actions.ts';
import { useWorkspace } from '@/state/use-workspace.ts';
import { AggregateField, DimensionField, MeasureField, SeriesField } from '@/ui/canvas/column-channel-fields.tsx';
import { useChartChannels } from '@/ui/canvas/use-chart-channels.ts';
import { AGGREGATES, buildQuery, CHART_KINDS } from '@/ui/canvas/visualization-form.ts';

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
  const [series, setSeries] = useState(visualization.binding.series ?? '');
  const [aggregate, setAggregate] = useState<AggregateFunction>(currentAggregate(visualization));
  const [binCount, setBinCount] = useState(currentBinCount(visualization));

  const dataset = workspace.datasets[visualization.datasetId];

  const { measureColumns, binnable, dimensionColumns, seriesColumns, temporalBin, selection, binding, validation } =
    useChartChannels(workspace, dataset, { kind, x, y, series, aggregate, binCount });

  const titled = title.trim() !== '';

  const save = async (): Promise<void> => {
    if (dataset === undefined || validation?.ok !== true || !titled) {
      return;
    }

    const result = await actions.updateVisualization({
      visualizationId: visualization.id,
      title: title.trim(),
      kind,
      binding,
      query: buildQuery(dataset.id, selection),
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
        Chart{' '}
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
        Title <input value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} />
      </label>

      <DimensionField
        kind={kind}
        x={x}
        onXChange={setX}
        binnable={binnable}
        dimensionColumns={dimensionColumns}
        temporalBin={temporalBin}
        binCount={binCount}
        onBinCountChange={setBinCount}
      />

      <SeriesField kind={kind} series={series} onSeriesChange={setSeries} columns={seriesColumns} />

      <MeasureField kind={kind} y={y} onYChange={setY} columns={measureColumns} />

      <AggregateField kind={kind} aggregate={aggregate} onAggregateChange={setAggregate} />

      <button type="button" disabled={!titled || validation?.ok !== true} onClick={() => void save()}>
        Save view
      </button>

      {validation !== null && !validation.ok ? (
        <p className="visualization-editor__hint">{validation.error.message}</p>
      ) : null}
    </section>
  );
};
