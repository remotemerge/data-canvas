export interface QueryCacheKey {
  datasetId: string;
  datasetRevision: number;
  dimensions?: readonly unknown[];
  measures?: readonly unknown[];
  filters?: readonly unknown[];
  sort?: readonly unknown[];
  limit: number;
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

export interface QueryCache<T> {
  get(key: QueryCacheKey): T | undefined;
  set(key: QueryCacheKey, value: T): void;
  clear(): void;
}

export const createQueryCache = <T>(capacity = 50, maximumResultSize = 500): QueryCache<T> => {
  const entries = new Map<string, T>();

  return {
    get(key) {
      const serialized = createQueryCacheKey(key);
      const value = entries.get(serialized);
      if (value === undefined) return undefined;
      entries.delete(serialized);
      entries.set(serialized, value);
      return value;
    },
    set(key, value) {
      if (key.limit > maximumResultSize) return;
      const serialized = createQueryCacheKey(key);
      entries.delete(serialized);
      entries.set(serialized, value);
      while (entries.size > capacity) entries.delete(entries.keys().next().value as string);
    },
    clear() {
      entries.clear();
    },
  };
};
