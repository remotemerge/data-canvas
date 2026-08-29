import type {
  ClearSelectionInput,
  ExtendSelectionInput,
  SetSelectionInput,
} from '@/application/actions/action-types.ts';
import { omitKeys } from '@/application/actions/handlers/handler-types.ts';
import type { ActionHandler } from '@/application/actions/handlers/handler-types.ts';
import { resolveDataset } from '@/application/validation/validate-entity-refs.ts';
import type { Selection } from '@/domain/selection/selection.ts';
import { domainError } from '@/shared/errors/domain-error.ts';
import { createEntityId, ID_PREFIX } from '@/shared/ids/entity-id.ts';
import { err, ok } from '@/shared/result/result.ts';

/**
 * Upper bound on an explicit key selection.
 *
 * Key mode materializes row keys in application state, so it is capped. A selection larger than
 * this should be expressed as a predicate, which describes "all rows in Q4" without enumerating
 * them.
 */
export const MAX_SELECTION_KEYS = 10_000;

/**
 * Replaces the selection for a dataset.
 *
 * One selection per dataset. Two concurrent highlights on the same data would leave the table and
 * charts disagreeing about what is selected, so a new selection supersedes the old.
 */
export const handleSetSelection: ActionHandler<SetSelectionInput> = (workspace, payload) => {
  const dataset = resolveDataset(workspace, payload.datasetId);

  if (!dataset.ok) return dataset;

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

/**
 * Adds to the selection on a dataset instead of replacing it.
 *
 * Predicates union: "region = EU" extended by "region = APAC" selects both. Keys concatenate and are
 * de-duplicated. With nothing currently selected this is exactly `selection.set`, which is what lets
 * a ctrl-click sequence start on an empty canvas without a special case.
 *
 * A key selection that outgrows `MAX_SELECTION_KEYS` is refused with the same message `set` uses
 * rather than silently truncating — a selection that quietly dropped rows would misreport what is
 * highlighted.
 */
export const handleExtendSelection: ActionHandler<ExtendSelectionInput> = (workspace, payload, deps) => {
  const dataset = resolveDataset(workspace, payload.datasetId);

  if (!dataset.ok) return dataset;

  const existing = Object.values(workspace.selections).find((selection) => selection.datasetId === dataset.value.id);

  if (existing === undefined) return handleSetSelection(workspace, payload, deps);

  // Modes must agree: a union of a key list and a predicate has no single representation, and
  // guessing one would make the resulting selection mean something neither click asked for.
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

  // Flattened rather than nested, so extending repeatedly does not build a right-leaning tree of
  // single-operand `or` nodes that the compiler would have to walk on every query.
  const operands =
    existing.predicate?.kind === 'or'
      ? [...existing.predicate.operands]
      : existing.predicate === undefined
        ? []
        : [existing.predicate];
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

  if (!dataset.ok) return dataset;

  const cleared = Object.values(workspace.selections)
    .filter((selection) => selection.datasetId === dataset.value.id)
    .map((selection) => selection.id);

  return ok({
    workspace: { ...workspace, selections: omitKeys(workspace.selections, cleared) },
    changedEntityIds: cleared,
    summary: `Cleared the selection on '${dataset.value.name}'.`,
  });
};
