import { useMemo } from 'react';
import { useWorkspace } from '@/state/use-workspace.ts';

export const Provenance = ({ entityId, createdBy }: { entityId: string; createdBy: 'human' | 'agent' | 'system' }) => {
  // The selector returns the history array itself, not a filtered copy. Filtering inside the
  // selector allocates a new array on every store read, so `useSyncExternalStore` never sees two
  // equal snapshots and re-renders until React throws "Maximum update depth exceeded". This
  // component renders inside every chart panel and metric card, so that loop took down the canvas.
  const history = useWorkspace((state) => state.history);
  const entries = useMemo(
    () => history.filter((entry) => entry.changedEntityIds.includes(entityId)),
    [history, entityId],
  );
  return (
    <span className="provenance">
      {createdBy === 'agent' ? <span className="agent-created-badge">agent</span> : null}
      <details>
        <summary>History</summary>
        {entries.length === 0 ? (
          <p>No recorded changes.</p>
        ) : (
          <ol>
            {entries.toReversed().map((entry) => (
              <li key={entry.actionId}>
                {entry.summary} <small>{entry.actor}</small>
              </li>
            ))}
          </ol>
        )}
      </details>
    </span>
  );
};
