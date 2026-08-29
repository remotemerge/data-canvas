import type { ApplyFilterInput, ClearFiltersInput, RemoveFilterInput } from '@/application/actions/action-types.ts';
import { omitKeys } from '@/application/actions/handlers/handler-types.ts';
import type { ActionHandler } from '@/application/actions/handlers/handler-types.ts';
import { resolveDataset, resolveDatasetColumn, resolveFilter } from '@/application/validation/validate-entity-refs.ts';
import { validateFilter } from '@/application/validation/validate-filter.ts';
import type { Filter } from '@/domain/filter/filter.ts';
import { createEntityId, ID_PREFIX } from '@/shared/ids/entity-id.ts';
import { ok } from '@/shared/result/result.ts';

/**
 * Applies a filter to a column.
 *
 * Applying a second filter with the same column and operator *replaces* the first rather than
 * stacking a contradictory pair. An agent re-issuing a narrowed filter is expressing a new
 * intention, not asking for an unsatisfiable conjunction.
 */
export const handleApplyFilter: ActionHandler<ApplyFilterInput> = (workspace, payload, deps) => {
  const resolved = resolveDatasetColumn(workspace, payload.datasetId, payload.columnId);

  if (!resolved.ok) return resolved;

  const { dataset, column } = resolved.value;
  const compatible = validateFilter(column, payload.operator, payload.value);

  if (!compatible.ok) return compatible;

  const existing = Object.values(workspace.filters).find(
    (candidate) =>
      candidate.datasetId === dataset.id && candidate.columnId === column.id && candidate.operator === payload.operator,
  );

  const filter: Filter = {
    id: existing?.id ?? createEntityId(ID_PREFIX.filter),
    datasetId: dataset.id,
    columnId: column.id,
    operator: payload.operator,
    ...(payload.value === undefined ? {} : { value: payload.value }),
    enabled: payload.enabled ?? true,
    origin: deps.actor,
    createdBy: existing?.createdBy ?? deps.actor,
  };

  return ok({
    workspace: { ...workspace, filters: { ...workspace.filters, [filter.id]: filter } },
    changedEntityIds: [filter.id],
    // The value is deliberately absent from the summary; it can be a dataset cell value.
    summary: `${existing === undefined ? 'Applied' : 'Updated'} filter '${payload.operator}' on column '${column.name}'.`,
  });
};

export const handleRemoveFilter: ActionHandler<RemoveFilterInput> = (workspace, payload) => {
  const filter = resolveFilter(workspace, payload.filterId);

  if (!filter.ok) return filter;

  return ok({
    workspace: { ...workspace, filters: omitKeys(workspace.filters, [filter.value.id]) },
    changedEntityIds: [filter.value.id],
    summary: `Removed filter '${filter.value.operator}'.`,
  });
};

export const handleClearFilters: ActionHandler<ClearFiltersInput> = (workspace, payload) => {
  if (payload.datasetId === undefined) {
    const cleared = Object.keys(workspace.filters);

    return ok({
      workspace: { ...workspace, filters: {} },
      changedEntityIds: cleared,
      summary: `Cleared ${cleared.length} filters.`,
    });
  }

  const dataset = resolveDataset(workspace, payload.datasetId);

  if (!dataset.ok) return dataset;

  const cleared = Object.values(workspace.filters)
    .filter((filter) => filter.datasetId === dataset.value.id)
    .map((filter) => filter.id);

  return ok({
    workspace: { ...workspace, filters: omitKeys(workspace.filters, cleared) },
    changedEntityIds: cleared,
    summary: `Cleared ${cleared.length} filters on dataset '${dataset.value.name}'.`,
  });
};
