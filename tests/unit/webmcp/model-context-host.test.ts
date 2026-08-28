import { expect, test } from 'bun:test';
import { readInputSchema } from '@/webmcp/registry/model-context-host.ts';

test('registered tool schemas support object and legacy serialized forms', () => {
  const objectSchema = { type: 'object' };
  expect(readInputSchema({ name: 'one', inputSchema: objectSchema } as never)).toEqual(objectSchema);
  expect(readInputSchema({ name: 'two', inputSchema: JSON.stringify(objectSchema) } as never)).toEqual(objectSchema);
  expect(readInputSchema({ name: 'bad', inputSchema: '{' } as never)).toBeNull();
});
