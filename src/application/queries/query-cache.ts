export interface QueryCacheKey {
  datasetId: string;
  datasetRevision: number;
  dimensions?: readonly unknown[];
  measures?: readonly unknown[];
  filters?: readonly unknown[];
  sort?: readonly unknown[];
  limit: number;
  offset?: number;
  samplingPolicy?: unknown;
}

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .toSorted(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableValue(entry)]),
    );
  }
  return value;
};

export const createQueryCacheKey = (key: QueryCacheKey): string => JSON.stringify(stableValue(key));

/**
 * The part of a key that identifies the same underlying result set regardless of windowing.
 *
 * Two requests differing only in `limit` or `offset` read the same ordered rows, so a wider cached
 * result can serve a narrower one by slicing. Excluding those two fields is what makes that lookup
 * possible without a second index.
 */
export const createResultSetKey = (key: QueryCacheKey): string => {
  const { limit: _limit, offset: _offset, ...rest } = key;

  return JSON.stringify(stableValue(rest));
};

export interface CacheEntryCost {
  /** Rows the entry holds. Drives eviction weight, since a wide result costs more to keep. */
  size: number;
  /** Milliseconds the query took. An expensive entry resists eviction by a stream of cheap ones. */
  computeMs: number;
}

interface CacheEntry<T> {
  value: T;
  cost: CacheEntryCost;
  /** Monotonic access counter, standing in for recency without reading the clock. */
  usedAt: number;
  /** The entry's key with the window fields removed, so covering lookups compare like with like. */
  resultSetKey: string;
  limit: number;
  offset: number;
}

/**
 * A cached result that covers a narrower window than the one requested.
 *
 * The caller receives the wider value plus where its window starts, and slices accordingly. The
 * cache cannot do the slicing itself: it is generic over the value type and has no idea whether the
 * value is an array of rows, a count, or something else.
 */
export interface CoveringEntry<T> {
  value: T;
  /** Offset the cached value starts at, always at or before the requested offset. */
  offset: number;
  limit: number;
}

export interface QueryCache<T> {
  get(key: QueryCacheKey): T | undefined;
  /**
   * Finds a cached entry whose window contains the requested one.
   *
   * Separate from `get` because reuse is only valid for values the caller can slice; a count cached
   * under a different limit describes a different question and must not be reused this way.
   */
  getCovering(key: QueryCacheKey): CoveringEntry<T> | undefined;
  set(key: QueryCacheKey, value: T, cost?: CacheEntryCost): void;
  clear(): void;
  /** Hit and miss tallies, asserted by the performance regression tests. */
  statistics(): { hits: number; misses: number };
}

/**
 * The cache used for counts and analysis results.
 *
 * Eviction is weighted rather than plain LRU. Straight LRU lets a burst of trivial lookups evict a
 * multi-second aggregate that a chart is about to ask for again, which is precisely the case worth
 * keeping. The score combines recency with computation cost per row held, so a cheap large entry
 * goes before an expensive small one.
 */
/** Lower is evicted first: old, cheap, and large entries score lowest. */
const evictionScore = (entry: CacheEntry<unknown>): number =>
  entry.usedAt + Math.max(entry.cost.computeMs, 1) / Math.max(entry.cost.size, 1);

export const createQueryCache = <T>(capacity = 50, maximumResultSize = 500): QueryCache<T> => {
  const entries = new Map<string, CacheEntry<T>>();
  let clock = 0;
  let hits = 0;
  let misses = 0;

  const evict = (): void => {
    while (entries.size > capacity) {
      let victimKey: string | undefined;
      let victimScore = Number.POSITIVE_INFINITY;

      for (const [key, entry] of entries) {
        const candidate = evictionScore(entry);

        if (candidate < victimScore) {
          victimScore = candidate;
          victimKey = key;
        }
      }

      if (victimKey === undefined) return;

      entries.delete(victimKey);
    }
  };

  return {
    get(key) {
      clock += 1;

      const serialized = createQueryCacheKey(key);
      const exact = entries.get(serialized);

      if (exact !== undefined) {
        exact.usedAt = clock;
        hits += 1;

        return exact.value;
      }

      misses += 1;

      return undefined;
    },
    getCovering(key) {
      clock += 1;

      const serialized = createQueryCacheKey(key);
      const exact = entries.get(serialized);

      if (exact !== undefined) {
        exact.usedAt = clock;
        hits += 1;

        return { value: exact.value, offset: exact.offset, limit: exact.limit };
      }

      // Partial reuse. An entry over the same result set that starts no later and ends no earlier
      // than this request already holds every row the caller wants, so re-querying would read rows
      // that are in memory. The window bounds go back with the value; slicing belongs to the caller,
      // which is the only side that knows the value's shape.
      const resultSetKey = createResultSetKey(key);
      const offset = key.offset ?? 0;

      for (const entry of entries.values()) {
        if (entry.resultSetKey !== resultSetKey) continue;
        if (entry.offset > offset || entry.offset + entry.limit < offset + key.limit) continue;

        entry.usedAt = clock;
        hits += 1;

        return { value: entry.value, offset: entry.offset, limit: entry.limit };
      }

      misses += 1;

      return undefined;
    },
    set(key, value, cost) {
      if (key.limit > maximumResultSize) return;

      clock += 1;

      const serialized = createQueryCacheKey(key);

      entries.set(serialized, {
        value,
        cost: cost ?? { size: key.limit, computeMs: 1 },
        usedAt: clock,
        resultSetKey: createResultSetKey(key),
        limit: key.limit,
        offset: key.offset ?? 0,
      });

      evict();
    },
    clear() {
      entries.clear();
      hits = 0;
      misses = 0;
    },
    statistics: () => ({ hits, misses }),
  };
};
