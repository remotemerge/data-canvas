import { describe, expect, test } from 'bun:test';
import { createQueryCache, createQueryCacheKey, createResultSetKey } from '@/application/queries/query-cache.ts';
import type { QueryCacheKey } from '@/application/queries/query-cache.ts';

const key = (revision: number, limit = 10) => ({ datasetId: 'ds', datasetRevision: revision, filters: [], limit });

const windowedKey: QueryCacheKey = {
  datasetId: 'ds',
  datasetRevision: 1,
  dimensions: [{ z: 1, a: 2 }],
  limit: 10,
  offset: 0,
};

describe('query cache keys', () => {
  // Object key order follows how a caller happened to build the query, not what it asks for.
  test('two keys differing only in property order collide, so an equivalent query hits', () => {
    expect(createQueryCacheKey(windowedKey)).toBe(
      createQueryCacheKey({ ...windowedKey, dimensions: [{ a: 2, z: 1 }] }),
    );
  });

  // The result-set key names the ordered result, which the window slices rather than defines.
  test('the result-set key ignores the window so two windows share one underlying result', () => {
    expect(createResultSetKey(windowedKey)).toBe(createResultSetKey({ ...windowedKey, limit: 20, offset: 5 }));
  });

  test('a different revision produces a different key, so stale rows cannot be served', () => {
    expect(createQueryCacheKey(windowedKey)).not.toBe(createQueryCacheKey({ ...windowedKey, datasetRevision: 2 }));
  });
});

describe('covering windows', () => {
  test('an exact window is returned as its own covering entry', () => {
    const cache = createQueryCache<string>(2, 100);
    cache.set(windowedKey, 'first');

    expect(cache.getCovering(windowedKey)).toEqual({ value: 'first', offset: 0, limit: 10 });
  });

  test('a narrower window inside a cached one reuses it', () => {
    const cache = createQueryCache<string>(2, 100);
    cache.set(windowedKey, 'first');

    expect(cache.getCovering({ ...windowedKey, offset: 2, limit: 3 })).toEqual({
      value: 'first',
      offset: 0,
      limit: 10,
    });
  });

  // Rows 8 through 11 run past the cached window, so the missing tail must be fetched.
  test('a window running past the cached end is a miss', () => {
    const cache = createQueryCache<string>(2, 100);
    cache.set(windowedKey, 'first');

    expect(cache.getCovering({ ...windowedKey, offset: 8, limit: 3 })).toBeUndefined();
  });

  test('an empty cache reports a miss rather than a covering entry', () => {
    expect(createQueryCache<string>(2, 100).getCovering(windowedKey)).toBeUndefined();
  });
});

describe('query cache statistics', () => {
  test('counts hits and misses separately', () => {
    const cache = createQueryCache<string>(2, 100);
    cache.get(windowedKey);
    cache.set(windowedKey, 'first');
    cache.get(windowedKey);

    expect(cache.statistics()).toEqual({ hits: 1, misses: 1 });
  });

  test('clearing drops both the entries and the counters', () => {
    const cache = createQueryCache<string>(2, 100);
    cache.set(windowedKey, 'first');
    cache.get(windowedKey);
    cache.clear();

    expect(cache.statistics()).toEqual({ hits: 0, misses: 0 });
    expect(cache.get(windowedKey)).toBeUndefined();
  });
});

describe('weighted eviction', () => {
  // A cheap entry over many rows scores below a costly small one, so it is evicted first.
  test('keeps the entry that cost more to compute per row', () => {
    const cache = createQueryCache<string>(1, 100);
    cache.set({ ...windowedKey, limit: 20 }, 'cheap', { size: 1_000, computeMs: 1 });
    cache.set({ ...windowedKey, datasetRevision: 2, limit: 5 }, 'expensive', { size: 1, computeMs: 5_000 });

    expect(cache.get({ ...windowedKey, datasetRevision: 2, limit: 5 })).toBe('expensive');
    expect(cache.get({ ...windowedKey, limit: 20 })).toBeUndefined();
  });
});

describe('query cache', () => {
  test('keys entries by revision and refreshes LRU order', () => {
    const cache = createQueryCache<string>(2);
    cache.set(key(1), 'one');
    cache.set(key(2), 'two');
    expect(cache.get(key(1))).toBe('one');
    cache.set(key(3), 'three');
    expect(cache.get(key(2))).toBeUndefined();
    expect(cache.get(key(1))).toBe('one');
  });

  test('does not cache results above the bound', () => {
    const cache = createQueryCache<string>(50, 500);
    cache.set(key(1, 501), 'large');
    expect(cache.get(key(1, 501))).toBeUndefined();
  });
});
