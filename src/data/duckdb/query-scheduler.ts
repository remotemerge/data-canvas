// Serializes engine work and drops results superseded by newer requests.

// Outcome of a scheduled query; superseded work is a value, not an error.
export type ScheduledResult<T> = { stale: true } | { stale: false; value: T };

// Identifies scheduler cancellation.
export class QueryAbortedError extends Error {
  constructor() {
    super('The query was aborted before it completed.');
    this.name = 'QueryAbortedError';
  }
}

export interface ScheduleOptions {
  // Logical work key; requests sharing a key supersede one another.
  key: string;
  signal?: AbortSignal;
}

interface PendingEntry {
  token: number;
}

export interface QueryScheduler {
  schedule<T>(run: (signal: AbortSignal) => Promise<T>, options: ScheduleOptions): Promise<ScheduledResult<T>>;
  // Marks all in-flight queries stale during disposal or dataset removal.
  abortAll(): void;
}

export const createQueryScheduler = (): QueryScheduler => {
  // Monotonic request token used to order supersession.
  let nextToken = 0;

  // Newest token for each key.
  const latest = new Map<string, PendingEntry>();

  // Abort controllers for in-flight queries.
  const controllers = new Map<number, AbortController>();

  // Runs a query serially and skips work already superseded.
  let queue: Promise<unknown> = Promise.resolve();

  const isCurrent = (key: string, token: number): boolean => latest.get(key)?.token === token;

  const schedule = <T>(
    run: (signal: AbortSignal) => Promise<T>,
    options: ScheduleOptions,
  ): Promise<ScheduledResult<T>> => {
    const token = nextToken;

    nextToken += 1;

    // Mark a request stale before queuing it so it can be skipped while waiting.
    const superseded = latest.get(options.key);

    if (superseded !== undefined) controllers.get(superseded.token)?.abort();

    latest.set(options.key, { token });

    const controller = new AbortController();

    controllers.set(token, controller);

    if (options.signal !== undefined) {
      if (options.signal.aborted) controller.abort();
      else options.signal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    const result = queue.then(async (): Promise<ScheduledResult<T>> => {
      // Skip superseded work before it reaches the engine.
      if (!isCurrent(options.key, token) || controller.signal.aborted) return { stale: true };

      try {
        const value = await run(controller.signal);

        // A newer same-key request may have arrived while the engine worked.
        return isCurrent(options.key, token) ? { stale: false, value } : { stale: true };
      } catch (error) {
        if (controller.signal.aborted || !isCurrent(options.key, token)) return { stale: true };

        throw error;
      } finally {
        controllers.delete(token);

        if (isCurrent(options.key, token)) latest.delete(options.key);
      }
    });

    // Keep the queue usable after an unexpected rejection.
    queue = result.catch(() => undefined);

    return result;
  };

  return {
    schedule,
    abortAll: () => {
      for (const controller of controllers.values()) controller.abort();

      controllers.clear();
      latest.clear();
    },
  };
};
