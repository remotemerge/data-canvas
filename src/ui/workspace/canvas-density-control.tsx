import { MAX_LAYOUT_COLUMNS, MIN_LAYOUT_COLUMNS } from '@/application/actions/handlers/layout-handlers.ts';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import { selectLayoutColumns } from '@/state/selectors/workspace-selectors.ts';
import { useActions } from '@/state/use-actions.ts';
import { useWorkspace } from '@/state/use-workspace.ts';

/**
 * Preset densities.
 *
 * Discrete presets rather than a free numeric input: canvas density is a coarse layout choice, and
 * every value between them produces near-identical grids.
 */
const DENSITY_PRESETS: readonly { label: string; columns: number }[] = [
  { label: 'Comfortable', columns: 6 },
  { label: 'Balanced', columns: 12 },
  { label: 'Compact', columns: 18 },
] as const;

interface CanvasDensityControlProps {
  onError: (error: DomainError | null) => void;
}

/**
 * Changes canvas density through the shared dispatcher.
 *
 * This is a real feature and also the smallest complete demonstration of the mutation path: it
 * validates, commits atomically, increments the revision, and appends a history entry, without
 * needing a dataset.
 */
export const CanvasDensityControl = ({ onError }: CanvasDensityControlProps): React.JSX.Element => {
  const columns = useWorkspace(selectLayoutColumns);
  const { updateLayout } = useActions();

  const applyDensity = (nextColumns: number): void => {
    void updateLayout({ columns: nextColumns }).then((result) => {
      onError(result.ok ? null : result.error);
    });
  };

  return (
    <section className="density">
      <h2 className="workspace__panel-heading">Canvas density</h2>

      <div className="density__options" role="group" aria-label="Canvas density">
        {DENSITY_PRESETS.map((preset) => (
          <button
            key={preset.columns}
            type="button"
            className="density__option"
            aria-pressed={preset.columns === columns}
            onClick={() => applyDensity(preset.columns)}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <p className="density__value">
        {columns} of {MIN_LAYOUT_COLUMNS}–{MAX_LAYOUT_COLUMNS} columns
      </p>
    </section>
  );
};
