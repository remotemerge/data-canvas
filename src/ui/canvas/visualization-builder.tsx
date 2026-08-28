import { useMemo, useState } from 'react';
import { validateVisualization } from '@/application/validation/validate-visualization.ts';
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

export const VisualizationBuilder = ({ onError }: { onError: (error: DomainError) => void }) => {
  const datasets = useWorkspace((state) => state.workspace.datasets);
  const layoutItems = useWorkspace((state) => state.workspace.layout.items);
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
  const dataset = datasets[datasetId];
  const numericColumns = dataset?.columns.filter((column) => column.logicalType === 'number') ?? [];
  const validationMeasure = y === '' ? numericColumns[0]?.id : y;
  const dimensionColumns =
    dataset?.columns.filter((column) => {
      if (kind === 'kpi' || validationMeasure === undefined) return false;
      return validateVisualization(dataset, kind, { x: column.id, y: [validationMeasure] }).ok;
    }) ?? [];
  const binding: VisualBinding =
    kind === 'kpi' ? { y: y === '' ? [] : [y] } : { ...(x === '' ? {} : { x }), ...(y === '' ? {} : { y: [y] }) };
  const validation = dataset === undefined ? null : validateVisualization(dataset, kind, binding);

  const create = async () => {
    if (dataset === undefined || validation === null || !validation.ok) return;
    const dimensions = x === '' ? [] : [x];
    const result = await actions.createVisualization({
      datasetId,
      title,
      kind,
      binding,
      linkedSelection: true,
      query: { datasetId, dimensions, measures: y === '' ? [] : [{ columnId: y, aggregate }], filters: [] },
    });
    if (!result.ok) {
      onError(result.error);
      return;
    }
    const visualizationId = result.value.changedEntityIds[0];
    if (visualizationId !== undefined) {
      const layout = await actions.updateLayout({
        items: [
          ...layoutItems,
          {
            visualizationId,
            x: 0,
            y: layoutItems.reduce((bottom, item) => Math.max(bottom, item.y + item.height), 0),
            width: 6,
            height: 4,
          },
        ],
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
        <input value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} />
      </label>
      {kind === 'kpi' ? null : (
        <label>
          Dimension
          <select value={x} onChange={(event) => setX(event.target.value)}>
            <option value="">Choose</option>
            {dimensionColumns.map((column) => (
              <option key={column.id} value={column.id}>
                {column.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        Measure
        <select value={y} onChange={(event) => setY(event.target.value)}>
          <option value="">Choose</option>
          {numericColumns.map((column) => (
            <option key={column.id} value={column.id}>
              {column.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Aggregate
        <select value={aggregate} onChange={(event) => setAggregate(event.target.value as AggregateFunction)}>
          {['sum', 'avg', 'min', 'max', 'median'].map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
      </label>
      <button
        type="button"
        disabled={title.trim() === '' || validation === null || !validation.ok}
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
