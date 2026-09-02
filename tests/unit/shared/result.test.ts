import { describe, expect, test } from 'bun:test';
import { domainError } from '@/shared/errors/domain-error.ts';
import { err, isErr, isOk, ok } from '@/shared/result/result.ts';

const failure = err(domainError('UNSUPPORTED_OPERATION', 'failure'));

describe('isOk', () => {
  test('accepts a success and narrows it to its value', () => {
    const result = ok(1);

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) {
      throw new Error('expected a success');
    }
    expect(result.value).toBe(1);
  });

  test('rejects a failure', () => {
    expect(isOk(failure)).toBe(false);
  });
});

describe('isErr', () => {
  test('accepts a failure and narrows it to its error', () => {
    expect(isErr(failure)).toBe(true);
    if (!isErr(failure)) {
      throw new Error('expected a failure');
    }
    expect(failure.error.code).toBe('UNSUPPORTED_OPERATION');
  });

  test('rejects a success', () => {
    expect(isErr(ok(1))).toBe(false);
  });
});
