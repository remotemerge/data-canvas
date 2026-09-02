import { useSyncExternalStore } from 'react';
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

  // Announced politely so a non-visual user notices the agent starting or finishing work.
  return (
    <output className="agent-status" data-active={status.executingCount > 0}>
      {describeStatus()}
    </output>
  );
};
