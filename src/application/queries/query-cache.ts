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
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }
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

// Key for the underlying ordered result, excluding its window.
export const createResultSetKey = (key: QueryCacheKey): string => {
  const { limit: _limit, offset: _offset, ...rest } = key;

  return JSON.stringify(stableValue(rest));
};

export interface CacheEntryCost {
  // Rows held by the entry; used for weighted eviction.
  size: number;
  // Query duration in milliseconds; expensive entries receive more cache weight.
  computeMs: number;
}

interface CacheEntry<T> {
  value: T;
  cost: CacheEntryCost;
  // Monotonic access counter used for recency.
  usedAt: number;
  // Underlying result key without window fields.
  resultSetKey: string;
  limit: number;
  offset: number;
}

// Cached value whose window contains the requested window.
export interface CoveringEntry<T> {
  value: T;
  // Offset of the cached value.
  offset: number;
  limit: number;
}

export interface QueryCache<T> {
  get(key: QueryCacheKey): T | undefined;
  // Finds a cached entry whose window contains the requested one.
  getCovering(key: QueryCacheKey): CoveringEntry<T> | undefined;
  set(key: QueryCacheKey, value: T, cost?: CacheEntryCost): void;
  clear(): void;
  // Cache hit and miss counts.
  statistics(): { hits: number; misses: number };
}

// Weighted cache for counts and analysis results.
// Lower scores are evicted first.
const evictionScore = (entry: CacheEntry<unknown>): number =>
  entry.usedAt + Math.max(entry.cost.computeMs, 1) / Math.max(entry.cost.size, 1);

const normalizeCost = (cost: CacheEntryCost): CacheEntryCost => ({
  size: Number.isFinite(cost.size) && cost.size > 0 ? cost.size : 1,
  computeMs: Number.isFinite(cost.computeMs) && cost.computeMs >= 0 ? cost.computeMs : 1,
});

export const createQueryCache = <T>(capacity = 50, maximumResultSize = 500): QueryCache<T> => {
  const normalizedCapacity = Number.isFinite(capacity) ? Math.max(Math.trunc(capacity), 0) : 0;
  const entries = new Map<string, CacheEntry<T>>();
  let clock = 0;
  let hits = 0;
  let misses = 0;

  const evict = (): void => {
    while (entries.size > normalizedCapacity) {
      let victimKey: string | undefined;
      let victimScore = Number.POSITIVE_INFINITY;

      for (const [key, entry] of entries) {
        const candidate = evictionScore(entry);

        if (candidate < victimScore) {
          victimScore = candidate;
          victimKey = key;
        }
      }

      entries.delete(victimKey as string);
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

      // Reuse a wider cached window; the caller slices it because only the caller knows the value's shape.
      const resultSetKey = createResultSetKey(key);
      const offset = key.offset ?? 0;

      for (const entry of entries.values()) {
        if (entry.resultSetKey !== resultSetKey) {
          continue;
        }
        if (entry.offset > offset || entry.offset + entry.limit < offset + key.limit) {
          continue;
        }

        entry.usedAt = clock;
        hits += 1;

        return { value: entry.value, offset: entry.offset, limit: entry.limit };
      }

      misses += 1;

      return undefined;
    },
    set(key, value, cost) {
      if (key.limit > maximumResultSize) {
        return;
      }

      clock += 1;

      const serialized = createQueryCacheKey(key);

      entries.set(serialized, {
        value,
        cost: normalizeCost(cost ?? { size: key.limit, computeMs: 1 }),
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
