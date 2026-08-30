import { useSyncExternalStore } from 'react';
import { getToolStatus, subscribeToolStatus } from '@/webmcp/registry/tool-status.ts';

export const AgentStatusIndicator = (): React.JSX.Element => {
  const status = useSyncExternalStore(subscribeToolStatus, getToolStatus, getToolStatus);

  const message = !status.available
    ? 'Agent tools unavailable in this browser'
    : status.executingCount > 0
      ? `Agent is using ${status.executingCount} tool${status.executingCount === 1 ? '' : 's'}`
      : `${status.registeredCount} agent tools available`;

  return (
    <span className="agent-status" data-active={status.executingCount > 0}>
      {message}
    </span>
  );
};
