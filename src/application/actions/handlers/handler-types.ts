import type { Actor } from '@/application/actions/action-types.ts';
import type { DataEnginePort } from '@/application/ports/data-engine-port.ts';
import type { Workspace } from '@/domain/workspace/workspace.ts';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import type { EntityId } from '@/shared/ids/entity-id.ts';
import type { Result } from '@/shared/result/result.ts';

// Dependencies available to an action handler.
export interface HandlerDeps {
  dataEngine: DataEnginePort;
  actor: Actor;
}

/**
 * Result returned by a handler.
 *
 * `workspace` is a new value. The dispatcher assigns its revision and timestamp at commit time.
 */
export interface HandlerOutcome {
  workspace: Workspace;
  changedEntityIds: EntityId[];
  // Value-free summary recorded in history and returned to the caller.
  summary: string;
}

// Handlers return values; the dispatcher commits workspace state and revision together.
export type ActionHandler<TPayload> = (
  workspace: Workspace,
  payload: TPayload,
  deps: HandlerDeps,
) => Result<HandlerOutcome, DomainError> | Promise<Result<HandlerOutcome, DomainError>>;

// Omits selected entries from a normalized entity map without mutating it.
export const omitKeys = <T>(record: Record<EntityId, T>, keys: readonly EntityId[]): Record<EntityId, T> => {
  const next: Record<EntityId, T> = { ...record };

  for (const key of keys) {
    delete next[key];
  }

  return next;
};
