import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { formatCellValue } from '@/table/tanstack/table-columns.ts';

test('cell HTML renders as literal text', () => {
  const hostile = '<img src=x onerror=alert(1)>';
  const markup = renderToStaticMarkup(<td>{formatCellValue(hostile)}</td>);
  expect(markup).toContain('&lt;img src=x onerror=alert(1)&gt;');
  expect(markup).not.toContain('<img');
});
