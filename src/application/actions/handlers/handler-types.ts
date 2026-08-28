import type { Actor } from '@/application/actions/action-types.ts';
import type { DataEnginePort } from '@/application/ports/data-engine-port.ts';
import type { Workspace } from '@/domain/workspace/workspace.ts';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import type { EntityId } from '@/shared/ids/entity-id.ts';
import type { Result } from '@/shared/result/result.ts';

/** What a handler needs from the outside world. Everything else it derives from the workspace. */
export interface HandlerDeps {
  dataEngine: DataEnginePort;
  actor: Actor;
}

/**
 * What a handler produces.
 *
 * `workspace` is the *next* workspace, not a mutation of the one passed in. The dispatcher owns
 * revision and timestamp; a handler must not set either, so that revision stays incrementable in
 * exactly one place.
 */
export interface HandlerOutcome {
  workspace: Workspace;
  changedEntityIds: EntityId[];
  /** Value-free prose recorded in history and returned to the caller. */
  summary: string;
}

/**
 * Handlers return the next workspace rather than writing to the store.
 *
 * That keeps them unit-testable as plain functions and leaves the store commit — the only place
 * where state and revision must move together — under the dispatcher's sole control.
 */
export type ActionHandler<TPayload> = (
  workspace: Workspace,
  payload: TPayload,
  deps: HandlerDeps,
) => Result<HandlerOutcome, DomainError> | Promise<Result<HandlerOutcome, DomainError>>;

/** Removes entries from a normalized entity map without mutating the original. */
export const omitKeys = <T>(record: Record<EntityId, T>, keys: readonly EntityId[]): Record<EntityId, T> => {
  const next: Record<EntityId, T> = { ...record };

  for (const key of keys) delete next[key];

  return next;
};
