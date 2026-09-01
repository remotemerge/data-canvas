import { useMemo } from 'react';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import { useActions } from '@/state/use-actions.ts';
import { useWorkspace } from '@/state/use-workspace.ts';

// Use a deterministic radial layout for the small acyclic relationship graph.
const VIEWBOX = 320;
const CENTER = VIEWBOX / 2;
const RADIUS = 110;
const NODE_RADIUS = 26;

// Maximum datasets shown in the radial graph.
const MAX_RENDERED_NODES = 12;

// Renders dataset relationships as a small SVG diagram.
export const RelationshipGraph = ({ onError }: { onError: (error: DomainError) => void }): React.JSX.Element => {
  const datasets = useWorkspace((state) => state.workspace.datasets);
  const relationships = useWorkspace((state) => state.workspace.relationships);
  const actions = useActions();

  const nodes = useMemo(() => {
    const ready = Object.values(datasets)
      .filter((dataset) => dataset.importStatus === 'ready')
      .slice(0, MAX_RENDERED_NODES);

    return ready.map((dataset, index) => {
      // Place a single dataset at the center; arrange larger graphs around it.
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
    if (!result.ok) {
      onError(result.error);
    }
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
            {/* Dataset names are untrusted text. */}
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
