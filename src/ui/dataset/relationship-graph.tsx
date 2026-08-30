import { useMemo } from 'react';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import { useActions } from '@/state/use-actions.ts';
import { useWorkspace } from '@/state/use-workspace.ts';

/*
 * Layout constants. A radial arrangement rather than a force simulation: the graph is acyclic and
 * small by construction, and a deterministic layout means the same workspace always draws the same
 * shape — which matters more here than optimal edge routing.
 */
const VIEWBOX = 320;
const CENTER = VIEWBOX / 2;
const RADIUS = 110;
const NODE_RADIUS = 26;

/** Beyond this a radial layout stops being readable and the textual list below carries the detail. */
const MAX_RENDERED_NODES = 12;

/**
 * A node/edge view of datasets and their relationships.
 *
 * Past three datasets a textual list stops conveying the shape of the join graph — which dataset is
 * the hub, which is a leaf, what a query can reach. Plain SVG, no charting dependency: this is a
 * schema diagram, not a data visualization, so ECharts would be the wrong tool as well as a new
 * import in a module that does not need one.
 */
export const RelationshipGraph = ({ onError }: { onError: (error: DomainError) => void }): React.JSX.Element => {
  const datasets = useWorkspace((state) => state.workspace.datasets);
  const relationships = useWorkspace((state) => state.workspace.relationships);
  const actions = useActions();

  const nodes = useMemo(() => {
    const ready = Object.values(datasets)
      .filter((dataset) => dataset.importStatus === 'ready')
      .slice(0, MAX_RENDERED_NODES);

    return ready.map((dataset, index) => {
      // A single dataset sits at the centre; otherwise nodes spread evenly around the circle.
      const angle = ready.length === 1 ? 0 : (index / ready.length) * 2 * Math.PI - Math.PI / 2;

      return {
        dataset,
        x: ready.length === 1 ? CENTER : CENTER + RADIUS * Math.cos(angle),
        y: ready.length === 1 ? CENTER : CENTER + RADIUS * Math.sin(angle),
      };
    });
  }, [datasets]);

  const edges = useMemo(
    () =>
      Object.values(relationships).flatMap((relationship) => {
        const from = nodes.find((node) => node.dataset.id === relationship.leftDatasetId);
        const to = nodes.find((node) => node.dataset.id === relationship.rightDatasetId);

        return from === undefined || to === undefined ? [] : [{ relationship, from, to }];
      }),
    [relationships, nodes],
  );

  const remove = async (relationshipId: string): Promise<void> => {
    const result = await actions.removeRelationship({ relationshipId });
    if (!result.ok) onError(result.error);
  };

  if (nodes.length === 0) {
    return <p className="workspace__empty">Import a dataset to see the relationship graph.</p>;
  }

  return (
    <section className="relationship-graph" aria-labelledby="relationship-graph-title">
      <h2 id="relationship-graph-title" className="workspace__panel-heading">
        Relationships
      </h2>

      <svg
        className="relationship-graph__canvas"
        viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
        role="img"
        aria-label={`${nodes.length} datasets connected by ${edges.length} relationships`}
      >
        {edges.map(({ relationship, from, to }) => (
          <line
            key={relationship.id}
            className="relationship-graph__edge"
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            data-join={relationship.join}
          />
        ))}

        {nodes.map((node) => (
          <g key={node.dataset.id} className="relationship-graph__node">
            <circle cx={node.x} cy={node.y} r={NODE_RADIUS} />
            {/* Dataset names are untrusted display text; SVG text renders them as a text child. */}
            <text x={node.x} y={node.y + NODE_RADIUS + 12} textAnchor="middle">
              {node.dataset.name}
            </text>
          </g>
        ))}
      </svg>

      {edges.length === 0 ? (
        <p className="workspace__empty">No relationships yet.</p>
      ) : (
        <ul className="relationship-graph__list">
          {edges.map(({ relationship, from, to }) => (
            <li key={relationship.id}>
              <span>
                {from.dataset.name} → {to.dataset.name}
              </span>
              <span className="relationship-graph__meta">
                {relationship.join} · {relationship.kind.replaceAll('_', ' ')}
              </span>
              <button
                type="button"
                aria-label={`Remove relationship between ${from.dataset.name} and ${to.dataset.name}`}
                onClick={() => void remove(relationship.id)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
