import { domainError } from '@/shared/errors/domain-error.ts';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import { err, ok } from '@/shared/result/result.ts';
import type { Result } from '@/shared/result/result.ts';

interface FileSystemWritable {
  write(data: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

interface SaveFileHandle {
  createWritable(): Promise<FileSystemWritable>;
}

interface ShowSaveFilePicker {
  (options: {
    suggestedName: string;
    types: { description: string; accept: Record<string, string[]> }[];
  }): Promise<SaveFileHandle>;
}

const savePicker = (): ShowSaveFilePicker | undefined =>
  (globalThis as { showSaveFilePicker?: ShowSaveFilePicker }).showSaveFilePicker;

/**
 * Writes an archive to disk, streaming where the browser allows it.
 *
 * The File System Access API takes each chunk as it is produced, so a large export never exists in
 * memory as one buffer. Where it is unavailable the chunks are collected into a `Blob` and
 * downloaded — the same result, but bounded by memory, which is why the streaming path is preferred
 * rather than being an enhancement.
 *
 * A cancelled picker is reported as a domain error carrying `aborted`, so a caller can distinguish
 * "the user changed their mind" from "the export failed".
 */
export const saveArchive = async (
  suggestedName: string,
  run: (write: (chunk: Uint8Array) => Promise<void>) => Promise<Result<void, DomainError>>,
): Promise<Result<void, DomainError>> => {
  const picker = savePicker();

  if (picker !== undefined) {
    let writable: FileSystemWritable;

    try {
      const handle = await picker({
        suggestedName,
        types: [{ description: 'Data Canvas workspace', accept: { 'application/zip': ['.zip'] } }],
      });

      writable = await handle.createWritable();
    } catch {
      // The picker throws on dismissal, which is a choice rather than a failure.
      return err(domainError('UNSUPPORTED_OPERATION', 'The export was cancelled.', { aborted: true }));
    }

    try {
      const outcome = await run((chunk) => writable.write(chunk));

      await writable.close();

      return outcome;
    } catch {
      await writable.close().catch(() => undefined);

      return err(domainError('UNSUPPORTED_OPERATION', 'The workspace could not be written to that file.'));
    }
  }

  const chunks: BlobPart[] = [];
  const outcome = await run((chunk) => {
    // Copied because the caller may reuse its buffer once the write resolves.
    chunks.push(new Uint8Array(chunk));

    return Promise.resolve();
  });

  if (!outcome.ok) return outcome;

  const url = URL.createObjectURL(new Blob(chunks, { type: 'application/zip' }));
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = suggestedName;
  anchor.click();
  URL.revokeObjectURL(url);

  return ok(undefined);
};
