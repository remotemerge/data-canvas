import { useMemo } from 'react';
import { useWorkspace } from '@/state/use-workspace.ts';

export const Provenance = ({ entityId, createdBy }: { entityId: string; createdBy: 'human' | 'agent' | 'system' }) => {
  // Keep selector output stable; filtering here would allocate on every store read and trigger a snapshot loop.
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
