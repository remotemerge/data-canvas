import { useMemo } from 'react';
import { useWorkspace } from '@/state/use-workspace.ts';

export const Provenance = ({ entityId, createdBy }: { entityId: string; createdBy: 'human' | 'agent' | 'system' }) => {
  // Keep selector output stable; filtering here would allocate on every store read and trigger a snapshot loop.
  const history = useWorkspace((state) => state.history);
  const entries = useMemo(
    () => history.filter((entry) => entry.changedEntityIds.includes(entityId)),
    [history, entityId],
  );
  /*
   * `createdBy` records only who made the artifact, so an agent chart a human has since edited still
   * reads as purely agent work. The badge names the creator and marks later human edits, which is the
   * question someone scanning the canvas is actually asking.
   */
  const editedByHuman = useMemo(
    () => createdBy === 'agent' && entries.slice(1).some((entry) => entry.actor === 'human'),
    [createdBy, entries],
  );

  return (
    <span className="provenance">
      {createdBy === 'agent' ? (
        <span
          className="agent-created-badge"
          title={editedByHuman ? 'Created by the agent, edited by you' : 'Created by the agent'}
        >
          {editedByHuman ? 'agent · edited' : 'agent'}
        </span>
      ) : null}
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
