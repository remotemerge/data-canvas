import { useMemo, useState } from 'react';
import { suggestVisualizationTitle } from '@/application/layout/visualization-title.ts';
import type { AggregateFunction } from '@/domain/metric/metric.ts';
import type { VisualizationKind } from '@/domain/visualization/visualization.ts';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import { useActions } from '@/state/use-actions.ts';
import { useWorkspace } from '@/state/use-workspace.ts';
import { AggregateField, DimensionField, MeasureField } from '@/ui/canvas/column-channel-fields.tsx';
import { useChartChannels } from '@/ui/canvas/use-chart-channels.ts';
import { buildQuery, CHART_KINDS } from '@/ui/canvas/visualization-form.ts';

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

  const { scopedColumns, measureColumns, binnable, dimensionColumns, temporalBin, selection, binding, validation } =
    useChartChannels(workspace, dataset, { kind, x, y, aggregate, binCount });

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
    if (dataset === undefined || validation?.ok !== true) {
      return;
    }

    const result = await actions.createVisualization({
      datasetId,
      title: effectiveTitle,
      kind,
      binding,
      query: buildQuery(datasetId, selection),
    });
    if (!result.ok) {
      onError(result.error);
      return;
    }
    setTitle('');
  };

  return (
    <section className="visualization-builder" aria-labelledby="visualization-builder-title">
      <header className="visualization-builder__header">
        <h2 id="visualization-builder-title">Add a view</h2>
        <p>Choose a dataset and the columns to chart. Dimension groups rows, measure is the number summarized.</p>
      </header>
      <div className="visualization-builder__body">
        <label>
          Dataset{' '}
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
          Chart{' '}
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
        <MeasureField kind={kind} y={y} onYChange={setY} columns={measureColumns} />
        <AggregateField kind={kind} aggregate={aggregate} onAggregateChange={setAggregate} />
        <button
          type="button"
          disabled={effectiveTitle.trim() === '' || validation?.ok !== true}
          onClick={() => void create()}
        >
          Create view
        </button>
        {validation !== null && !validation.ok ? (
          <p className="visualization-builder__hint">{validation.error.message}</p>
        ) : null}
      </div>
    </section>
  );
};
