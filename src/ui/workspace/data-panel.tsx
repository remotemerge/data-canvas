import { LuChevronDown, LuChevronUp } from 'react-icons/lu';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dataset } from '@/domain/dataset/dataset.ts';
import { WorkspaceTable } from '@/table/tanstack/workspace-table.tsx';
import { Button } from '@/ui/components/ui/button.tsx';

// Panel height bounds as a fraction of workspace height.
const MIN_HEIGHT_FRACTION = 0.15;
const MAX_HEIGHT_FRACTION = 0.65;

// Default open share of the workspace body.
const DEFAULT_HEIGHT_FRACTION = 0.45;

// Keyboard resize step as a fraction of the workspace body.
const KEYBOARD_STEP = 0.05;

const clampFraction = (value: number): number => Math.min(Math.max(value, MIN_HEIGHT_FRACTION), MAX_HEIGHT_FRACTION);

// Resizable bottom panel for the row-level table.
export const DataPanel = ({
  dataset,
  // Uses all remaining height while the canvas has no chart.
  fills = false,
}: {
  dataset: Dataset;
  fills?: boolean;
}): React.JSX.Element => {
  const [fraction, setFraction] = useState(DEFAULT_HEIGHT_FRACTION);
  const [collapsed, setCollapsed] = useState(false);
  const [resizing, setResizing] = useState(false);
  const panelRef = useRef<HTMLElement>(null);

  const resizeTo = useCallback((clientY: number) => {
    const container = panelRef.current?.parentElement;

    if (container === null || container === undefined) return;

    const bounds = container.getBoundingClientRect();

    if (bounds.height <= 0) return;

    // Measure from the bottom because the handle is on the panel's top edge.
    setFraction(clampFraction((bounds.bottom - clientY) / bounds.height));
  }, []);

  // Listen on window so fast drags and outside releases still finish.
  useEffect(() => {
    if (!resizing) return;

    const onMove = (event: PointerEvent): void => {
      event.preventDefault();
      resizeTo(event.clientY);
    };
    const stop = (): void => setResizing(false);

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);

    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
  }, [resizing, resizeTo]);

  const nudge = (delta: number): void => {
    setCollapsed(false);
    setFraction((current) => clampFraction(current + delta));
  };

  return (
    <section
      ref={panelRef}
      className="data-panel"
      data-collapsed={collapsed}
      data-fills={fills}
      style={collapsed || fills ? undefined : { height: `${fraction * 100}%` }}
      aria-label="Data"
    >
      {/* The separator resizes the panel with pointer or keyboard input and is absent when it fills the canvas. */}
      {fills ? null : (
        <div
          className="data-panel__handle"
          role="separator"
          tabIndex={0}
          aria-label="Resize data panel"
          aria-orientation="horizontal"
          aria-valuenow={Math.round(fraction * 100)}
          aria-valuemin={Math.round(MIN_HEIGHT_FRACTION * 100)}
          aria-valuemax={Math.round(MAX_HEIGHT_FRACTION * 100)}
          onPointerDown={(event) => {
            event.preventDefault();
            setCollapsed(false);
            setResizing(true);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowUp') nudge(KEYBOARD_STEP);
            else if (event.key === 'ArrowDown') nudge(-KEYBOARD_STEP);
            else return;

            event.preventDefault();
          }}
        />
      )}
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
