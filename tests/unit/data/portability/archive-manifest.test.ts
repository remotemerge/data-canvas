import { describe, expect, test } from 'bun:test';
import {
  computeChecksum,
  isArchiveManifest,
  isSafeDataPath,
  MAX_ARCHIVE_FILES,
} from '@/data/portability/archive-manifest.ts';
import { crc32, readArchive, ZipWriter } from '@/data/portability/workspace-archive.ts';

const checksum = 'a'.repeat(64);

const manifest = (overrides: Record<string, unknown> = {}) => ({
  appVersion: '1.0.0',
  exportedAt: '2026-08-29T00:00:00.000Z',
  mode: 'full',
  counts: { datasets: 1 },
  files: [{ path: 'data/dataset_abc.parquet', byteSize: 10, checksum }],
  workspaceChecksum: checksum,
  ...overrides,
});

/** Collects a ZipWriter's chunks, standing in for a file sink. */
const intoBuffer = () => {
  const chunks: Uint8Array[] = [];
  const write = (chunk: Uint8Array): Promise<void> => {
    chunks.push(new Uint8Array(chunk));
    return Promise.resolve();
  };
  const bytes = (): Uint8Array => {
    const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return merged;
  };
  return { write, bytes };
};

describe('archive manifest validation', () => {
  test('accepts a well-formed manifest', () => expect(isArchiveManifest(manifest())).toBe(true));

  test('rejects a non-object', () => {
    expect(isArchiveManifest(null)).toBe(false);
    expect(isArchiveManifest('manifest')).toBe(false);
  });

  test('rejects an unknown export mode', () => expect(isArchiveManifest(manifest({ mode: 'partial' }))).toBe(false));

  test('rejects a malformed checksum', () =>
    expect(isArchiveManifest(manifest({ workspaceChecksum: 'not-hex' }))).toBe(false));

  test('rejects duplicate file paths, which could shadow a verified entry', () =>
    expect(
      isArchiveManifest(
        manifest({
          files: [
            { path: 'data/a.parquet', byteSize: 1, checksum },
            { path: 'data/a.parquet', byteSize: 2, checksum },
          ],
        }),
      ),
    ).toBe(false));

  test('rejects more files than the bound allows', () =>
    expect(
      isArchiveManifest(
        manifest({
          files: Array.from({ length: MAX_ARCHIVE_FILES + 1 }, (_unused, index) => ({
            path: `data/f${index}.parquet`,
            byteSize: 1,
            checksum,
          })),
        }),
      ),
    ).toBe(false));
});

describe('archive path safety', () => {
  test('accepts a path inside the data directory', () => expect(isSafeDataPath('data/dataset_a.parquet')).toBe(true));

  test('rejects traversal and absolute-looking paths', () => {
    expect(isSafeDataPath('data/../../etc/passwd')).toBe(false);
    expect(isSafeDataPath('../data/x.parquet')).toBe(false);
    expect(isSafeDataPath('data//x.parquet')).toBe(false);
    expect(isSafeDataPath('data\\x.parquet')).toBe(false);
    expect(isSafeDataPath('workspace.json')).toBe(false);
    expect(isSafeDataPath('data/')).toBe(false);
  });
});

describe('checksums', () => {
  test('differ when a single byte changes', async () => {
    const first = await computeChecksum(new Uint8Array([1, 2, 3]));
    const second = await computeChecksum(new Uint8Array([1, 2, 4]));
    expect(first).not.toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('zip round trip', () => {
  test('writes entries a reader recovers verbatim', async () => {
    const sink = intoBuffer();
    const writer = new ZipWriter(sink.write);
    const payload = new TextEncoder().encode('{"name":"workspace"}');
    await writer.addEntry('workspace.json', payload);
    await writer.addEntry('data/dataset_a.parquet', new Uint8Array([9, 8, 7]));
    await writer.finish();

    const entries = readArchive(sink.bytes(), { maxFiles: 10, maxDecompressedBytes: 1024 });
    expect([...entries.keys()]).toEqual(['workspace.json', 'data/dataset_a.parquet']);
    expect(entries.get('workspace.json')).toEqual(payload);
    expect(entries.get('data/dataset_a.parquet')).toEqual(new Uint8Array([9, 8, 7]));
  });

  test('rejects a truncated archive', async () => {
    const sink = intoBuffer();
    const writer = new ZipWriter(sink.write);
    await writer.addEntry('workspace.json', new Uint8Array(64));
    await writer.finish();

    const truncated = sink.bytes().subarray(0, 40);
    expect(() => readArchive(truncated, { maxFiles: 10, maxDecompressedBytes: 1024 })).toThrow();
  });

  test('rejects a tampered entry whose CRC no longer matches', async () => {
    const sink = intoBuffer();
    const writer = new ZipWriter(sink.write);
    await writer.addEntry('workspace.json', new TextEncoder().encode('original'));
    await writer.finish();

    const bytes = sink.bytes();
    // Flip a byte inside the entry payload, leaving the recorded CRC in the header intact. The
    // payload starts after the 30-byte local header and the entry name.
    const payloadStart = 30 + 'workspace.json'.length;
    bytes[payloadStart] = bytes[payloadStart]! ^ 0xff;
    expect(() => readArchive(bytes, { maxFiles: 10, maxDecompressedBytes: 1024 })).toThrow();
  });

  test('rejects an archive claiming more decompressed bytes than the bound', async () => {
    const sink = intoBuffer();
    const writer = new ZipWriter(sink.write);
    await writer.addEntry('workspace.json', new Uint8Array(512));
    await writer.finish();

    expect(() => readArchive(sink.bytes(), { maxFiles: 10, maxDecompressedBytes: 100 })).toThrow();
  });

  test('computes a stable CRC-32', () => expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926));
});
