import { LuChevronDown, LuChevronUp } from 'react-icons/lu';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dataset } from '@/domain/dataset/dataset.ts';
import { WorkspaceTable } from '@/table/tanstack/workspace-table.tsx';
import { Button } from '@/ui/components/ui/button.tsx';

/**
 * Panel height bounds, as a fraction of the workspace body.
 *
 * The floor keeps enough rows visible for the table to still be a view rather than a header, and the
 * ceiling reserves space for the charts so dragging can never hide the canvas entirely.
 */
const MIN_HEIGHT_FRACTION = 0.15;
const MAX_HEIGHT_FRACTION = 0.65;

/**
 * Opening share of the workspace.
 *
 * The panel's handle, title bar, and row count take roughly 60px before any row renders, so a third
 * of the body left only about five rows visible. This is chosen against what the chart region needs
 * to avoid scrolling — its builder, margins, and the card's own floor — so the table gains rows from
 * space that was otherwise slack rather than from the chart.
 */
const DEFAULT_HEIGHT_FRACTION = 0.45;

/** Keyboard resize step, as a fraction of the body. Matches roughly a few table rows per press. */
const KEYBOARD_STEP = 0.05;

const clampFraction = (value: number): number => Math.min(Math.max(value, MIN_HEIGHT_FRACTION), MAX_HEIGHT_FRACTION);

/**
 * The workspace's bottom data panel: a resizable, collapsible home for the row-level table.
 *
 * Sized independently of the charts rather than taking whatever vertical space they leave. The table
 * is a primary analytical view, and as a leftover it collapsed into a shallow strip as soon as a
 * chart grew.
 *
 * The height is a fraction rather than a pixel count so it survives a window resize proportionally,
 * and it is view state rather than workspace state — a panel size is not something an agent acts on
 * or that belongs in the undo history.
 */
export const DataPanel = ({
  dataset,
  /**
   * Take all remaining height instead of the stored fraction.
   *
   * Set while the canvas holds no chart. The fraction is kept rather than overwritten, so adding a
   * first chart returns the panel to whatever height the user had already dragged it to.
   */
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

    // Measured from the bottom, because the handle sits at the panel's top edge: dragging it up
    // grows the panel.
    setFraction(clampFraction((bounds.bottom - clientY) / bounds.height));
  }, []);

  // Bound to the window rather than the handle so a fast drag that outruns the pointer keeps
  // resizing, and so releasing outside the panel still ends it.
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
      {/*
        A separator rather than a button: it reports its position so a screen-reader user can hear
        how the space is split, and the arrow keys resize it without a pointer.

        Absent while the panel fills the canvas: with no chart above it there is no boundary to move,
        so a control that cannot change anything would only mislead.
      */}
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
      {/* Unmounted rather than hidden when collapsed: the table windows its rows through DuckDB, so
          keeping it mounted would leave it fetching for a view nobody is looking at. */}
      {collapsed ? null : (
        <div className="data-panel__body">
          <WorkspaceTable dataset={dataset} />
        </div>
      )}
    </section>
  );
};
