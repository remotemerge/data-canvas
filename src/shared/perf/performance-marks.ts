export interface PerformanceRecord {
  name: string;
  durationMs?: number;
  rowsReturned?: number;
  recordedAt: string;
}

const records: PerformanceRecord[] = [];
let measurementId = 0;

const append = (record: Omit<PerformanceRecord, 'recordedAt'>): void => {
  if (!import.meta.env.DEV) return;
  records.push({ ...record, recordedAt: new Date().toISOString() });
};

export const measureAsync = async <T>(name: string, operation: () => Promise<T>): Promise<T> => {
  if (!import.meta.env.DEV) return operation();
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
  if (!import.meta.env.DEV) return operation();
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
  if (!import.meta.env.DEV) return;
  requestAnimationFrame(() => append({ name, durationMs: 0 }));
};

export const getPerformanceRecords = (): readonly PerformanceRecord[] => structuredClone(records);
