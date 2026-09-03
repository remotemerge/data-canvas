import type { UpdateLayoutInput } from '@/application/actions/action-types.ts';
import type { ActionHandler } from '@/application/actions/handlers/handler-types.ts';
import { refitLayoutColumns } from '@/application/layout/place-visualization.ts';
import { resolveVisualization } from '@/application/validation/validate-entity-refs.ts';
import { domainError } from '@/shared/errors/domain-error.ts';
import { err, ok } from '@/shared/result/result.ts';

// Supported canvas column range.
export const MIN_LAYOUT_COLUMNS = 1;
export const MAX_LAYOUT_COLUMNS = 24;

// Maximum number of visualization items in the layout.
export const MAX_LAYOUT_ITEMS = 200;

// Merges supplied layout fields with the current layout.
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

    // Reject slots for missing visualizations so the canvas cannot reserve empty chart space.
    for (const item of payload.items) {
      const visualization = resolveVisualization(workspace, item.visualizationId);

      if (!visualization.ok) {
        return visualization;
      }

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

  /*
   * Supplied items are already expressed in the target grid. Otherwise a density change rescales the
   * existing ones, which would otherwise keep coordinates from the previous column count and leave
   * charts overflowing the narrower canvas.
   */
  const items = payload.items ?? refitLayoutColumns(workspace.layout.items, workspace.layout.columns, columns);

  return ok({
    workspace: { ...workspace, layout: { columns, items } },
    changedEntityIds: items.map((item) => item.visualizationId),
    summary:
      payload.columns === undefined
        ? `Repositioned ${items.length} canvas items.`
        : `Set canvas density to ${columns} columns.`,
  });
};
