import { useSyncExternalStore } from 'react';
import { AgentToolsSheet } from '@/ui/workspace/agent-tools-sheet.tsx';
import { getToolStatus, subscribeToolStatus } from '@/webmcp/registry/tool-status.ts';

const plural = (count: number): string => (count === 1 ? '' : 's');

export const AgentStatusIndicator = (): React.JSX.Element => {
  const status = useSyncExternalStore(subscribeToolStatus, getToolStatus, getToolStatus);

  const describeStatus = (): string => {
    if (!status.available) {
      return 'Agent tools unavailable in this browser';
    }
    if (status.executingCount > 0) {
      return `Agent is using ${status.executingCount} tool${plural(status.executingCount)}`;
    }
    return `${status.registeredCount} agent tool${plural(status.registeredCount)} available`;
  };

  const label = describeStatus();

  /*
   * The status stays a live region so a non-visual user hears the agent start and finish work. When
   * tools are registered the same status doubles as the entry point to the contract behind the count,
   * which is otherwise only visible to a connected agent.
   */
  return (
    <output className="agent-status-indicator" data-active={status.executingCount > 0}>
      {status.tools.length === 0 ? (
        <span className="agent-status" data-active={status.executingCount > 0}>
          {label}
        </span>
      ) : (
        <AgentToolsSheet tools={status.tools} label={label} active={status.executingCount > 0} />
      )}
    </output>
  );
};
