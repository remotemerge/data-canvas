export interface PerformanceRecord {
  name: string;
  durationMs?: number;
  rowsReturned?: number;
  recordedAt: string;
}

/*
 * Vite statically replaces `import.meta.env.DEV`, so production builds fold this constant to `false` and
 * drop the instrumentation entirely. Keep it a module-level constant rather than a function so that
 * folding survives. Test runners leave `DEV` undefined, so fall back to `NODE_ENV` instead of defaulting
 * to enabled: an unrecognized environment must not start recording.
 */
const isInstrumented = import.meta.env?.DEV ?? process.env['NODE_ENV'] === 'test';

export const createPerformanceInstrumentation = (enabled: boolean) => {
  const records: PerformanceRecord[] = [];
  let measurementId = 0;
  const append = (record: Omit<PerformanceRecord, 'recordedAt'>): void => {
    if (enabled) {
      records.push({ ...record, recordedAt: new Date().toISOString() });
    }
  };

  return {
    measureAsync: async <T>(name: string, operation: () => Promise<T>): Promise<T> => {
      if (!enabled) {
        return operation();
      }
      measurementId += 1;
      const start = `${name}:${measurementId}:start`;
      const end = `${name}:${measurementId}:end`;
      performance.mark(start);
      try {
        return await operation();
      } finally {
        performance.mark(end);
        const measure = performance.measure(name, start, end);
        append({ name, durationMs: measure.duration });
        performance.clearMarks(start);
        performance.clearMarks(end);
        performance.clearMeasures(name);
      }
    },
    measureSync: <T>(name: string, operation: () => T): T => {
      if (!enabled) {
        return operation();
      }
      const startedAt = performance.now();
      try {
        return operation();
      } finally {
        append({ name, durationMs: performance.now() - startedAt });
      }
    },
    recordRowsReturned: (name: string, rowsReturned: number): void => {
      append({ name, rowsReturned });
    },
    recordRenderCompletion: (name: string): void => {
      if (enabled) {
        requestAnimationFrame(() => append({ name, durationMs: 0 }));
      }
    },
    getPerformanceRecords: (): readonly PerformanceRecord[] => structuredClone(records),
  };
};

export const { measureAsync, measureSync, recordRowsReturned, recordRenderCompletion, getPerformanceRecords } =
  createPerformanceInstrumentation(isInstrumented);
