import { describe, expect, test } from 'bun:test';
import { createQueryCache } from '@/application/queries/query-cache.ts';

const key = (revision: number, limit = 10) => ({ datasetId: 'ds', datasetRevision: revision, filters: [], limit });

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
