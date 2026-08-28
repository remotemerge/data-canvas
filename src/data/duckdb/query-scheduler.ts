/**
 * Serializes engine work and discards results nobody is waiting for any more.
 *
 * Two problems are solved together:
 *
 * 1. **Staleness.** When a user filters or scrolls faster than queries complete, an older, slower
 *    result can arrive after a newer one and overwrite it. Each request carries a logical key; a
 *    newer request on the same key supersedes the in-flight one, whose result is then dropped.
 * 2. **Pile-up.** DuckDB-Wasm executes sequentially per connection, so unbounded concurrent
 *    requests only queue inside the worker where nothing can cancel them.
 *
 * The key-based superseding is load-bearing rather than a flicker optimization. WebMCP tool
 * handlers are written single-argument and so carry no `AbortSignal`, which makes this the primary
 * mechanism keeping an agent's rapid successive requests from accumulating.
 */

/**
 * The outcome of a scheduled query.
 *
 * `stale` is a value rather than a rejection because being superseded is the expected result of
 * normal interaction, not a failure. Callers branch on it and return without touching state; an
 * exception would force every call site into a try/catch that means "this was fine".
 */
export type ScheduledResult<T> = { stale: true } | { stale: false; value: T };

/** Distinguishes an internal cancellation from a genuine engine failure. */
export class QueryAbortedError extends Error {
  constructor() {
    super('The query was aborted before it completed.');
    this.name = 'QueryAbortedError';
  }
}

export interface ScheduleOptions {
  /**
   * Logical work identity, e.g. `table-window` or `viz:<id>`. Requests sharing a key supersede one
   * another; requests with different keys are independent and both complete.
   */
  key: string;
  signal?: AbortSignal;
}

interface PendingEntry {
  token: number;
}

export interface QueryScheduler {
  schedule<T>(run: (signal: AbortSignal) => Promise<T>, options: ScheduleOptions): Promise<ScheduledResult<T>>;
  /** Marks every in-flight query stale. Used when the engine is disposed or a dataset is removed. */
  abortAll(): void;
}

export const createQueryScheduler = (): QueryScheduler => {
  /**
   * Monotonic issue order. Comparing tokens rather than timestamps keeps supersession exact: two
   * requests issued within the same millisecond still order deterministically.
   */
  let nextToken = 0;

  /** The newest token per key. An arriving result is current only if its token still matches. */
  const latest = new Map<string, PendingEntry>();

  /** Controllers for in-flight work, so a superseded or aborted query can stop early. */
  const controllers = new Map<number, AbortController>();

  /**
   * Runs queries one at a time.
   *
   * Chaining onto a single promise rather than firing concurrently: the engine holds one
   * connection, so concurrent calls would serialize inside the worker anyway, but without the
   * scheduler ever getting the chance to skip work already known to be stale.
   */
  let queue: Promise<unknown> = Promise.resolve();

  const isCurrent = (key: string, token: number): boolean => latest.get(key)?.token === token;

  const schedule = <T>(
    run: (signal: AbortSignal) => Promise<T>,
    options: ScheduleOptions,
  ): Promise<ScheduledResult<T>> => {
    const token = nextToken;

    nextToken += 1;

    // Supersede before queuing, not when execution starts: a request queued behind a slow query
    // must already be marked obsolete if a newer one arrives while it waits.
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
      // Skipping superseded work before it reaches the engine is the whole point: the newer query
      // for this key starts sooner because the obsolete one never ran.
      if (!isCurrent(options.key, token) || controller.signal.aborted) return { stale: true };

      try {
        const value = await run(controller.signal);

        // Re-checked after the await. A newer request for the same key may have arrived while the
        // engine worked, in which case this result must not reach the caller.
        return isCurrent(options.key, token) ? { stale: false, value } : { stale: true };
      } catch (error) {
        if (controller.signal.aborted || !isCurrent(options.key, token)) return { stale: true };

        throw error;
      } finally {
        controllers.delete(token);

        if (isCurrent(options.key, token)) latest.delete(options.key);
      }
    });

    // The queue must not stay rejected: one failing query would otherwise poison every later one.
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
