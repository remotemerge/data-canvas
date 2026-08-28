import type { SetTableSortInput } from '@/application/actions/action-types.ts';
import type { ActionHandler } from '@/application/actions/handlers/handler-types.ts';
import { resolveDataset } from '@/application/validation/validate-entity-refs.ts';
import { domainError } from '@/shared/errors/domain-error.ts';
import { err, ok } from '@/shared/result/result.ts';

export const handleSetTableSort: ActionHandler<SetTableSortInput> = (workspace, payload) => {
  const dataset = resolveDataset(workspace, payload.datasetId);
  if (!dataset.ok) return dataset;
  if (payload.sort.length > 10)
    return err(domainError('RESULT_LIMIT_EXCEEDED', 'A table can use at most 10 sort columns.'));
  for (const sort of payload.sort) {
    if (sort.columnId === undefined || !dataset.value.columns.some((column) => column.id === sort.columnId)) {
      return err(domainError('COLUMN_NOT_FOUND', 'The table sort references a column that does not exist.'));
    }
  }
  return ok({
    workspace: { ...workspace, tableSorts: { ...workspace.tableSorts, [dataset.value.id]: payload.sort } },
    changedEntityIds: [dataset.value.id],
    summary: `Updated table sorting for dataset '${dataset.value.name}'.`,
  });
};
