import { useMemo } from 'react';
import { recentHistory } from '@/application/history/action-history.ts';
import { selectHistory } from '@/state/selectors/workspace-selectors.ts';
import { useWorkspace } from '@/state/use-workspace.ts';

// Maximum history entries shown in the panel.
const VISIBLE_ENTRIES = 50;

// Shows recent activity with actor attribution.
export const ActionHistoryPanel = (): React.JSX.Element => {
  const history = useWorkspace(selectHistory);

  const entries = useMemo(() => recentHistory(history, VISIBLE_ENTRIES), [history]);

  const latestEntry = entries[0];

  return (
    <section className="history">
      <h2 className="workspace__panel-heading">Activity</h2>

      {/*
        Workspace changes can originate from the agent while focus sits elsewhere, so the
        newest entry is announced politely to keep non-visual users aware of agent activity.
      */}
      <p className="sr-only" aria-live="polite">
        {latestEntry === undefined ? '' : `${latestEntry.actor} action: ${latestEntry.summary}`}
      </p>

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
