import { LuChevronDown, LuChevronUp } from 'react-icons/lu';
import { useState } from 'react';
import type { Dataset } from '@/domain/dataset/dataset.ts';
import { WorkspaceTable } from '@/table/tanstack/workspace-table.tsx';
import { Button } from '@/ui/components/ui/button.tsx';

// Open share of the workspace body when a chart shares the canvas.
const DEFAULT_HEIGHT_FRACTION = 0.3;

// Collapsible bottom panel for the row-level table.
export const DataPanel = ({
  dataset,
  // Uses all remaining height while the canvas has no chart.
  fills = false,
}: {
  dataset: Dataset;
  fills?: boolean;
}): React.JSX.Element => {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <section
      className="data-panel"
      data-collapsed={collapsed}
      data-fills={fills}
      style={collapsed || fills ? undefined : { height: `${DEFAULT_HEIGHT_FRACTION * 100}%` }}
      aria-label="Data"
    >
      <div className="data-panel__bar">
        <h2 className="data-panel__title">Data</h2>
        <Button
          variant="ghost"
          size="icon"
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand data panel' : 'Collapse data panel'}
          onClick={() => setCollapsed((current) => !current)}
        >
          {collapsed ? <LuChevronUp size={15} aria-hidden="true" /> : <LuChevronDown size={15} aria-hidden="true" />}
        </Button>
      </div>
      {/* Unmount the collapsed table to stop windowed reads. */}
      {collapsed ? null : (
        <div className="data-panel__body">
          <WorkspaceTable dataset={dataset} />
        </div>
      )}
    </section>
  );
};
