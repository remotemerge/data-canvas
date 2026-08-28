import type { UpdateLayoutInput } from '@/application/actions/action-types.ts';
import type { ActionHandler } from '@/application/actions/handlers/handler-types.ts';
import { resolveVisualization } from '@/application/validation/validate-entity-refs.ts';
import { domainError } from '@/shared/errors/domain-error.ts';
import { err, ok } from '@/shared/result/result.ts';

/**
 * Canvas density bounds.
 *
 * A single column stacks charts vertically; the upper bound keeps a grid cell wide enough to render
 * a readable chart at any practical viewport width.
 */
export const MIN_LAYOUT_COLUMNS = 1;
export const MAX_LAYOUT_COLUMNS = 24;

/** Bound on placed items, keeping layout proportional to the number of charts a canvas can hold. */
export const MAX_LAYOUT_ITEMS = 200;

/**
 * Updates the canvas layout.
 *
 * Omitted fields keep their current value, so changing density does not disturb placement and
 * repositioning does not reset density.
 */
export const handleUpdateLayout: ActionHandler<UpdateLayoutInput> = (workspace, payload) => {
  const columns = payload.columns ?? workspace.layout.columns;

  if (!Number.isInteger(columns) || columns < MIN_LAYOUT_COLUMNS || columns > MAX_LAYOUT_COLUMNS) {
    return err(
      domainError(
        'UNSUPPORTED_OPERATION',
        `Layout columns must be a whole number between ${MIN_LAYOUT_COLUMNS} and ${MAX_LAYOUT_COLUMNS}.`,
        { minColumns: MIN_LAYOUT_COLUMNS, maxColumns: MAX_LAYOUT_COLUMNS },
      ),
    );
  }

  if (payload.items !== undefined) {
    if (payload.items.length > MAX_LAYOUT_ITEMS) {
      return err(
        domainError('RESULT_LIMIT_EXCEEDED', `A layout holds at most ${MAX_LAYOUT_ITEMS} items.`, {
          maxItems: MAX_LAYOUT_ITEMS,
        }),
      );
    }

    // Every placed item must address a real visualization; otherwise the canvas reserves space for
    // a chart that will never render.
    for (const item of payload.items) {
      const visualization = resolveVisualization(workspace, item.visualizationId);

      if (!visualization.ok) return visualization;

      if (item.width < 1 || item.height < 1 || item.x < 0 || item.y < 0 || item.x + item.width > columns) {
        return err(
          domainError(
            'UNSUPPORTED_OPERATION',
            `Layout item for '${visualization.value.title}' does not fit within ${columns} columns.`,
            { visualizationId: item.visualizationId, columns },
          ),
        );
      }
    }
  }

  const items = payload.items ?? workspace.layout.items;

  return ok({
    workspace: { ...workspace, layout: { columns, items } },
    changedEntityIds: items.map((item) => item.visualizationId),
    summary:
      payload.columns === undefined
        ? `Repositioned ${items.length} canvas items.`
        : `Set canvas density to ${columns} columns.`,
  });
};
