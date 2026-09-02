import type {
  ClearSelectionInput,
  ExtendSelectionInput,
  SetSelectionInput,
} from '@/application/actions/action-types.ts';
import { omitKeys } from '@/application/actions/handlers/handler-types.ts';
import type { ActionHandler } from '@/application/actions/handlers/handler-types.ts';
import { resolveColumn, resolveDataset } from '@/application/validation/validate-entity-refs.ts';
import { validateFilter } from '@/application/validation/validate-filter.ts';
import type { Dataset } from '@/domain/dataset/dataset.ts';
import type { FilterExpression } from '@/domain/filter/filter.ts';
import type { Selection } from '@/domain/selection/selection.ts';
import { domainError } from '@/shared/errors/domain-error.ts';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import { createEntityId, ID_PREFIX } from '@/shared/ids/entity-id.ts';
import { err, ok } from '@/shared/result/result.ts';
import type { Result } from '@/shared/result/result.ts';

// Maximum number of row keys stored for an explicit selection.
export const MAX_SELECTION_KEYS = 10_000;

// Bounds the predicate tree an agent or chart interaction can submit.
export const MAX_SELECTION_PREDICATE_DEPTH = 10;

/*
 * Validates a selection predicate against the dataset before it is committed.
 *
 * Without this, a type-incompatible predicate commits successfully and only fails later, once every
 * visualization query that propagates the selection tries to compile it.
 */
const validatePredicate = (dataset: Dataset, predicate: FilterExpression, depth = 0): Result<void, DomainError> => {
  if (depth > MAX_SELECTION_PREDICATE_DEPTH) {
    return err(
      domainError(
        'UNSUPPORTED_OPERATION',
        `A selection predicate may nest at most ${MAX_SELECTION_PREDICATE_DEPTH} levels.`,
        {
          maxDepth: MAX_SELECTION_PREDICATE_DEPTH,
        },
      ),
    );
  }

  if (predicate.kind === 'comparison') {
    const column = resolveColumn(dataset, predicate.columnId);

    return column.ok ? validateFilter(column.value, predicate.operator, predicate.value) : column;
  }

  if (predicate.kind === 'not') {
    return validatePredicate(dataset, predicate.operand, depth + 1);
  }

  for (const operand of predicate.operands) {
    const validated = validatePredicate(dataset, operand, depth + 1);

    if (!validated.ok) {
      return validated;
    }
  }

  return ok(undefined);
};

// Replaces the current selection for a dataset.
export const handleSetSelection: ActionHandler<SetSelectionInput> = (workspace, payload) => {
  const dataset = resolveDataset(workspace, payload.datasetId);

  if (!dataset.ok) {
    return dataset;
  }

  if (payload.mode === 'keys') {
    if (payload.keys === undefined || payload.keys.length === 0) {
      return err(domainError('UNSUPPORTED_OPERATION', "Selection mode 'keys' requires a non-empty key list."));
    }

    if (payload.keys.length > MAX_SELECTION_KEYS) {
      return err(
        domainError(
          'RESULT_LIMIT_EXCEEDED',
          `A key selection accepts at most ${MAX_SELECTION_KEYS} keys; use a predicate selection instead.`,
          { maxKeys: MAX_SELECTION_KEYS },
        ),
      );
    }
  } else if (payload.predicate === undefined) {
    return err(domainError('UNSUPPORTED_OPERATION', "Selection mode 'predicate' requires a predicate."));
  } else {
    const validated = validatePredicate(dataset.value, payload.predicate);

    if (!validated.ok) {
      return validated;
    }
  }

  const superseded = Object.values(workspace.selections)
    .filter((selection) => selection.datasetId === dataset.value.id)
    .map((selection) => selection.id);

  const selection: Selection = {
    id: createEntityId(ID_PREFIX.selection),
    datasetId: dataset.value.id,
    mode: payload.mode,
    ...(payload.keys === undefined ? {} : { keys: payload.keys }),
    ...(payload.predicate === undefined ? {} : { predicate: payload.predicate }),
    origin: payload.origin,
  };

  return ok({
    workspace: {
      ...workspace,
      selections: { ...omitKeys(workspace.selections, superseded), [selection.id]: selection },
    },
    changedEntityIds: [selection.id, ...superseded],
    summary:
      payload.mode === 'keys'
        ? `Highlighted ${payload.keys?.length ?? 0} records in '${dataset.value.name}'.`
        : `Highlighted a matching subset of '${dataset.value.name}'.`,
  });
};

// Extends the current selection with a predicate or bounded key list.
export const handleExtendSelection: ActionHandler<ExtendSelectionInput> = (workspace, payload, deps) => {
  const dataset = resolveDataset(workspace, payload.datasetId);

  if (!dataset.ok) {
    return dataset;
  }

  const existing = Object.values(workspace.selections).find((selection) => selection.datasetId === dataset.value.id);

  if (existing === undefined) {
    return handleSetSelection(workspace, payload, deps);
  }

  // Key and predicate modes cannot be combined without changing the selection's meaning.
  if (existing.mode !== payload.mode) {
    return err(
      domainError(
        'UNSUPPORTED_OPERATION',
        'That selection cannot be extended because it was made in a different mode. Clear it first.',
      ),
    );
  }

  if (payload.mode === 'keys') {
    if (payload.keys === undefined || payload.keys.length === 0) {
      return err(domainError('UNSUPPORTED_OPERATION', "Selection mode 'keys' requires a non-empty key list."));
    }

    const merged = [...new Set([...(existing.keys ?? []), ...payload.keys])];

    if (merged.length > MAX_SELECTION_KEYS) {
      return err(
        domainError(
          'RESULT_LIMIT_EXCEEDED',
          `A key selection accepts at most ${MAX_SELECTION_KEYS} keys; use a predicate selection instead.`,
          { maxKeys: MAX_SELECTION_KEYS },
        ),
      );
    }

    const extended: Selection = { ...existing, keys: merged, origin: payload.origin };

    return ok({
      workspace: { ...workspace, selections: { ...workspace.selections, [extended.id]: extended } },
      changedEntityIds: [extended.id],
      summary: `Highlighted ${merged.length} records in '${dataset.value.name}'.`,
    });
  }

  if (payload.predicate === undefined) {
    return err(domainError('UNSUPPORTED_OPERATION', "Selection mode 'predicate' requires a predicate."));
  }

  const validated = validatePredicate(dataset.value, payload.predicate);

  if (!validated.ok) {
    return validated;
  }

  // Flatten repeated extensions so the compiler does not walk a deep chain of single-operand `or` nodes.
  const collectOperands = (): FilterExpression[] => {
    if (existing.predicate === undefined) {
      return [];
    }
    return existing.predicate.kind === 'or' ? [...existing.predicate.operands] : [existing.predicate];
  };
  const operands = collectOperands();
  const extended: Selection = {
    ...existing,
    predicate: { kind: 'or', operands: [...operands, payload.predicate] },
    origin: payload.origin,
  };

  return ok({
    workspace: { ...workspace, selections: { ...workspace.selections, [extended.id]: extended } },
    changedEntityIds: [extended.id],
    summary: `Extended the selection on '${dataset.value.name}'.`,
  });
};

export const handleClearSelection: ActionHandler<ClearSelectionInput> = (workspace, payload) => {
  if (payload.datasetId === undefined) {
    const cleared = Object.keys(workspace.selections);

    return ok({
      workspace: { ...workspace, selections: {} },
      changedEntityIds: cleared,
      summary: `Cleared ${cleared.length} selections.`,
    });
  }

  const dataset = resolveDataset(workspace, payload.datasetId);

  if (!dataset.ok) {
    return dataset;
  }

  const cleared = Object.values(workspace.selections)
    .filter((selection) => selection.datasetId === dataset.value.id)
    .map((selection) => selection.id);

  return ok({
    workspace: { ...workspace, selections: omitKeys(workspace.selections, cleared) },
    changedEntityIds: cleared,
    summary: `Cleared the selection on '${dataset.value.name}'.`,
  });
};
