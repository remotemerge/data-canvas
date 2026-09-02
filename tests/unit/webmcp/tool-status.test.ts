import { afterEach, describe, expect, test } from 'bun:test';
import { getToolStatus, setToolStatus, subscribeToolStatus } from '@/webmcp/registry/tool-status.ts';

// The status snapshot is module state shared with the registry, so each test restores what it read.
afterEach(() => {
  setToolStatus({ available: false, registeredCount: 0, executingCount: 0 });
});

describe('tool status', () => {
  test('starts unavailable with nothing registered or executing', () => {
    expect(getToolStatus()).toEqual({ available: false, registeredCount: 0, executingCount: 0 });
  });

  test('a partial update leaves the untouched counters alone', () => {
    setToolStatus({ registeredCount: 3 });
    setToolStatus({ available: true });

    expect(getToolStatus()).toEqual({ available: true, registeredCount: 3, executingCount: 0 });
  });

  test('a subscriber sees the new snapshot on every change', () => {
    const notifications: ReturnType<typeof getToolStatus>[] = [];
    const unsubscribe = subscribeToolStatus(() => notifications.push(getToolStatus()));

    setToolStatus({ available: true });

    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.available).toBe(true);

    unsubscribe();
  });

  test('an unsubscribed listener stops receiving changes', () => {
    let calls = 0;
    const unsubscribe = subscribeToolStatus(() => {
      calls += 1;
    });

    unsubscribe();
    setToolStatus({ executingCount: 1 });

    expect(calls).toBe(0);
  });
});
