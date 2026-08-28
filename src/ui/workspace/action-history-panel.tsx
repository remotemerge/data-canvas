import { useMemo } from 'react';
import { recentHistory } from '@/application/history/action-history.ts';
import { selectHistory } from '@/state/selectors/workspace-selectors.ts';
import { useWorkspace } from '@/state/use-workspace.ts';

/** How many entries the panel shows. The full log is capped separately by the ring buffer. */
const VISIBLE_ENTRIES = 50;

/**
 * The shared activity log.
 *
 * Actor badges are the point of this panel: once agents write to the workspace, this is where a
 * human sees which changes were theirs and which were not, ordered by revision.
 *
 * Entries carry no payload values by construction, so nothing rendered here can be a dataset cell.
 * Summaries are still rendered as plain text, since they may quote a column display name.
 */
export const ActionHistoryPanel = (): React.JSX.Element => {
  const history = useWorkspace(selectHistory);

  const entries = useMemo(() => recentHistory(history, VISIBLE_ENTRIES), [history]);

  return (
    <section className="history">
      <h2 className="workspace__panel-heading">Activity</h2>

      {entries.length === 0 ? (
        <p className="workspace__empty">No actions yet.</p>
      ) : (
        <ol className="history__list">
          {entries.map((entry) => (
            <li key={entry.actionId} className="history__entry">
              <div className="history__meta">
                <span className={`history__actor history__actor--${entry.actor}`}>{entry.actor}</span>
                <span className="history__revision">r{entry.revision}</span>
              </div>
              <p className="history__summary">{entry.summary}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
};
