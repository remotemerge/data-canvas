import { useWorkspace } from '@/state/use-workspace.ts';

export const Provenance = ({ entityId, createdBy }: { entityId: string; createdBy: 'human' | 'agent' | 'system' }) => {
  const entries = useWorkspace((state) => state.history.filter((entry) => entry.changedEntityIds.includes(entityId)));
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
