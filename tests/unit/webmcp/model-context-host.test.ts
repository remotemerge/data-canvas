import { afterEach, describe, expect, test } from 'bun:test';
import type { ModelContext } from '@mcp-b/webmcp-types';
import { asChromeHost, readInputSchema, resolveModelContextHost } from '@/webmcp/registry/model-context-host.ts';

test('registered tool schemas support object and legacy serialized forms', () => {
  const objectSchema = { type: 'object' };
  expect(readInputSchema({ name: 'one', inputSchema: objectSchema } as never)).toEqual(objectSchema);
  expect(readInputSchema({ name: 'two', inputSchema: JSON.stringify(objectSchema) } as never)).toEqual(objectSchema);
  expect(readInputSchema({ name: 'bad', inputSchema: '{' } as never)).toBeNull();
});

describe('readInputSchema', () => {
  test('a tool without a schema reads as null rather than throwing', () => {
    expect(readInputSchema({} as never)).toBeNull();
  });

  test('a serialized array parses to an array', () => {
    expect(readInputSchema({ inputSchema: '[]' } as never)).toEqual([]);
  });

  test('unparsable serialized text reads as null', () => {
    expect(readInputSchema({ inputSchema: '{bad' } as never)).toBeNull();
  });
});

describe('asChromeHost', () => {
  // The cast narrows the host type for Chrome-only calls; it must not copy or wrap the host.
  test('returns the same host instance it was given', () => {
    const host = { registerTool: async () => undefined } as unknown as ModelContext;

    expect(asChromeHost(host)).toBe(host);
  });
});

describe('resolveModelContextHost', () => {
  const runtimeGlobal = globalThis as unknown as Record<string, unknown>;
  const documentDescriptor = Object.getOwnPropertyDescriptor(runtimeGlobal, 'document');
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(runtimeGlobal, 'navigator');

  const stubGlobal = (name: 'document' | 'navigator', value: unknown): void => {
    Object.defineProperty(runtimeGlobal, name, { configurable: true, value });
  };

  // Replacing the globals leaks into unrelated tests unless the original descriptors are restored.
  afterEach(() => {
    if (documentDescriptor === undefined) {
      Reflect.deleteProperty(runtimeGlobal, 'document');
    } else {
      Object.defineProperty(runtimeGlobal, 'document', documentDescriptor);
    }

    if (navigatorDescriptor === undefined) {
      Reflect.deleteProperty(runtimeGlobal, 'navigator');
    } else {
      Object.defineProperty(runtimeGlobal, 'navigator', navigatorDescriptor);
    }
  });

  test('prefers the document host over the navigator one', () => {
    stubGlobal('document', { modelContext: { source: 'document' } });
    stubGlobal('navigator', { modelContext: { source: 'navigator' } });

    expect(resolveModelContextHost()).toEqual({ source: 'document' } as unknown as ModelContext);
  });

  test('falls back to the navigator host when the document exposes none', () => {
    stubGlobal('document', {});
    stubGlobal('navigator', { modelContext: { source: 'navigator' } });

    expect(resolveModelContextHost()).toEqual({ source: 'navigator' } as unknown as ModelContext);
  });

  test('returns null in a browser that exposes no host at all', () => {
    stubGlobal('document', {});
    stubGlobal('navigator', {});

    expect(resolveModelContextHost()).toBeNull();
  });
});
