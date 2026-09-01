export interface PerformanceRecord {
  name: string;
  durationMs?: number;
  rowsReturned?: number;
  recordedAt: string;
}

const records: PerformanceRecord[] = [];
let measurementId = 0;

/*
 * Vite statically replaces `import.meta.env.DEV`, so production builds fold this constant to `false` and
 * drop the instrumentation entirely. Keep it a module-level constant rather than a function so that
 * folding survives. Test runners leave `DEV` undefined, so fall back to `NODE_ENV` instead of defaulting
 * to enabled: an unrecognized environment must not start recording.
 */
const isInstrumented = import.meta.env?.DEV ?? process.env['NODE_ENV'] === 'test';

const append = (record: Omit<PerformanceRecord, 'recordedAt'>): void => {
  if (!isInstrumented) {
    return;
  }
  records.push({ ...record, recordedAt: new Date().toISOString() });
};

export const measureAsync = async <T>(name: string, operation: () => Promise<T>): Promise<T> => {
  if (!isInstrumented) {
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
};

export const measureSync = <T>(name: string, operation: () => T): T => {
  if (!isInstrumented) {
    return operation();
  }
  const startedAt = performance.now();
  try {
    return operation();
  } finally {
    append({ name, durationMs: performance.now() - startedAt });
  }
};

export const recordRowsReturned = (name: string, rowsReturned: number): void => {
  append({ name, rowsReturned });
};

export const recordRenderCompletion = (name: string): void => {
  if (!isInstrumented) {
    return;
  }
  requestAnimationFrame(() => append({ name, durationMs: 0 }));
};

export const getPerformanceRecords = (): readonly PerformanceRecord[] => structuredClone(records);
