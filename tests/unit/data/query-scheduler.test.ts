import { describe, expect, test } from 'bun:test';
import { createQueryScheduler } from '@/data/duckdb/query-scheduler.ts';

const deferred = <T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } =>
  Promise.withResolvers<T>();

describe('query scheduler', () => {
  test('returns the value of a query nothing supersedes', async () => {
    const scheduler = createQueryScheduler();
    const result = await scheduler.schedule(() => Promise.resolve('window'), { key: 'table-window' });

    expect(result).toEqual({ stale: false, value: 'window' });
  });

  test('marks the older query stale when a newer one shares its key', async () => {
    const scheduler = createQueryScheduler();
    const first = deferred<string>();

    const slow = scheduler.schedule(() => first.promise, { key: 'table-window' });
    const fast = scheduler.schedule(() => Promise.resolve('new'), { key: 'table-window' });

    first.resolve('old');

    // Without supersession, an older result could overwrite a newer one.
    expect(await slow).toEqual({ stale: true });
    expect(await fast).toEqual({ stale: false, value: 'new' });
  });

  test('never runs a query that was superseded before it started', async () => {
    const scheduler = createQueryScheduler();
    const gate = deferred<string>();
    let secondRan = false;
    let thirdRan = false;

    const blocking = scheduler.schedule(() => gate.promise, { key: 'other' });
    const skipped = scheduler.schedule(
      () => {
        secondRan = true;

        return Promise.resolve('b');
      },
      { key: 'table-window' },
    );
    const winner = scheduler.schedule(
      () => {
        thirdRan = true;

        return Promise.resolve('c');
      },
      { key: 'table-window' },
    );

    gate.resolve('a');

    await blocking;

    expect(await skipped).toEqual({ stale: true });
    expect(await winner).toEqual({ stale: false, value: 'c' });

    // Skipping obsolete work before it reaches the engine is what lets the newer query start sooner.
    expect(secondRan).toBe(false);
    expect(thirdRan).toBe(true);
  });

  test('queries under different keys are independent', async () => {
    const scheduler = createQueryScheduler();

    const [table, chart] = await Promise.all([
      scheduler.schedule(() => Promise.resolve('rows'), { key: 'table-window' }),
      scheduler.schedule(() => Promise.resolve('series'), { key: 'viz:1' }),
    ]);

    expect(table).toEqual({ stale: false, value: 'rows' });
    expect(chart).toEqual({ stale: false, value: 'series' });
  });

  test('an already-aborted signal skips the query entirely', async () => {
    const scheduler = createQueryScheduler();
    const controller = new AbortController();
    let ran = false;

    controller.abort();

    const result = await scheduler.schedule(
      () => {
        ran = true;

        return Promise.resolve('x');
      },
      { key: 'table-window', signal: controller.signal },
    );

    expect(result).toEqual({ stale: true });
    expect(ran).toBe(false);
  });

  test('an abort during execution reports stale rather than a failure', async () => {
    const scheduler = createQueryScheduler();
    const controller = new AbortController();
    const gate = deferred<string>();

    const pending = scheduler.schedule(
      async (signal) => {
        controller.abort();

        await gate.promise;

        // The engine surfaces cancellation as a throw; the scheduler must classify it as stale.
        if (signal.aborted) throw new Error('aborted');

        return 'x';
      },
      { key: 'table-window', signal: controller.signal },
    );

    gate.resolve('x');

    expect(await pending).toEqual({ stale: true });
  });

  test('the running query receives a signal that aborts when it is superseded', async () => {
    const scheduler = createQueryScheduler();
    const gate = deferred<string>();
    let observed: AbortSignal | null = null;

    const first = scheduler.schedule(
      (signal) => {
        observed = signal;

        return gate.promise;
      },
      { key: 'table-window' },
    );

    // Let the first query start before superseding it.
    await Promise.resolve();
    await Promise.resolve();

    const second = scheduler.schedule(() => Promise.resolve('new'), { key: 'table-window' });

    expect(observed).not.toBeNull();
    expect((observed as unknown as AbortSignal).aborted).toBe(true);

    gate.resolve('old');

    expect(await first).toEqual({ stale: true });
    expect(await second).toEqual({ stale: false, value: 'new' });
  });

  test('a genuine failure of a current query is surfaced, not swallowed as stale', async () => {
    const scheduler = createQueryScheduler();

    // Masking real engine errors as staleness would leave a broken query silently showing nothing.
    expect(
      scheduler.schedule(() => Promise.reject(new Error('syntax error')), { key: 'table-window' }),
    ).rejects.toThrow('syntax error');
  });

  test('a failed query does not poison the ones behind it', async () => {
    const scheduler = createQueryScheduler();

    await scheduler.schedule(() => Promise.reject(new Error('boom')), { key: 'a' }).catch(() => undefined);

    expect(await scheduler.schedule(() => Promise.resolve('ok'), { key: 'b' })).toEqual({
      stale: false,
      value: 'ok',
    });
  });

  test('abortAll marks every in-flight query stale', async () => {
    const scheduler = createQueryScheduler();
    const gate = deferred<string>();

    const pending = scheduler.schedule(
      async (signal) => {
        await gate.promise;

        if (signal.aborted) throw new Error('aborted');

        return 'x';
      },
      { key: 'table-window' },
    );

    await Promise.resolve();
    await Promise.resolve();

    scheduler.abortAll();
    gate.resolve('x');

    expect(await pending).toEqual({ stale: true });
  });

  test('queries run one at a time rather than concurrently', async () => {
    const scheduler = createQueryScheduler();
    let running = 0;
    let peak = 0;

    const work = async (): Promise<number> => {
      running += 1;
      peak = Math.max(peak, running);

      await Promise.resolve();

      running -= 1;

      return peak;
    };

    await Promise.all([
      scheduler.schedule(work, { key: 'a' }),
      scheduler.schedule(work, { key: 'b' }),
      scheduler.schedule(work, { key: 'c' }),
    ]);

    // One connection serializes work; the scheduler must discard stale work.
    expect(peak).toBe(1);
  });
});
