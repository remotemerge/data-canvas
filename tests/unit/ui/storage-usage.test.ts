import { describe, expect, test } from 'bun:test';
import { formatUsage } from '@/ui/workspace/storage-panel.tsx';

describe('storage usage formatting', () => {
  test('reports zero when nothing is stored', () => {
    expect(formatUsage(0)).toBe('0 B');
  });

  test('reports small sizes in bytes rather than rounding them away', () => {
    expect(formatUsage(1)).toBe('1 B');
    expect(formatUsage(1023)).toBe('1023 B');
  });

  test('reports sub-megabyte sizes in kilobytes', () => {
    expect(formatUsage(1024)).toBe('1 KB');
    expect(formatUsage(40_960)).toBe('40 KB');
    expect(formatUsage(1_047_552)).toBe('1023 KB');
  });

  test('tips into megabytes rather than reporting a kilobyte figure that reached the next unit', () => {
    expect(formatUsage(1_048_575)).toBe('1.0 MB');
  });

  test('reports larger sizes in megabytes', () => {
    expect(formatUsage(1_048_576)).toBe('1.0 MB');
    expect(formatUsage(52_428_800)).toBe('50.0 MB');
  });
});
