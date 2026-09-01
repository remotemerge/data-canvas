import { afterEach, describe, expect, test } from 'bun:test';
import {
  getPerformanceRecords,
  measureAsync,
  measureSync,
  recordRenderCompletion,
  recordRowsReturned,
} from '@/shared/perf/performance-marks.ts';

const originalRequestAnimationFrame = globalThis.requestAnimationFrame;

afterEach(() => {
  globalThis.requestAnimationFrame = originalRequestAnimationFrame;
});

// Runs the frame callback synchronously so the recorded completion is observable in the same tick.
const runFrameImmediately = (): void => {
  globalThis.requestAnimationFrame = (callback) => {
    callback(0);

    return 0;
  };
};

const recordNamed = (name: string) => getPerformanceRecords().find((record) => record.name === name);

describe('measureAsync', () => {
  test('returns the value the operation resolved with', async () => {
    expect(await measureAsync('coverage-async-value', async () => 7)).toBe(7);
  });

  test('records the elapsed duration under the measurement name', async () => {
    await measureAsync('coverage-async-record', async () => 7);

    expect(recordNamed('coverage-async-record')?.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe('measureSync', () => {
  test('returns the value the operation produced', () => {
    expect(measureSync('coverage-sync-value', () => 8)).toBe(8);
  });

  test('records the elapsed duration under the measurement name', () => {
    measureSync('coverage-sync-record', () => 8);

    expect(recordNamed('coverage-sync-record')?.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe('recordRowsReturned', () => {
  test('records the row count under the measurement name', () => {
    recordRowsReturned('coverage-rows', 2);

    expect(recordNamed('coverage-rows')?.rowsReturned).toBe(2);
  });
});

describe('recordRenderCompletion', () => {
  test('records the completion once the next frame runs', () => {
    runFrameImmediately();
    recordRenderCompletion('coverage-render');

    expect(recordNamed('coverage-render')?.durationMs).toBe(0);
  });
});

describe('getPerformanceRecords', () => {
  // Callers receive a copy, so a reader cannot mutate the instrumentation log it is inspecting.
  test('returns a snapshot rather than the live record list', () => {
    recordRowsReturned('coverage-snapshot', 1);

    const first = getPerformanceRecords();

    recordRowsReturned('coverage-snapshot-later', 1);

    expect(first.some((record) => record.name === 'coverage-snapshot-later')).toBe(false);
    expect(getPerformanceRecords().some((record) => record.name === 'coverage-snapshot-later')).toBe(true);
  });
});
