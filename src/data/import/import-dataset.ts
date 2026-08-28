import {
  ALLOWED_EXTENSIONS,
  DELIMITER_BY_EXTENSION,
  MAX_COLUMN_COUNT,
  MAX_FILE_BYTES,
  fileExtension,
  formatByteBudget,
} from '@/data/import/import-limits.ts';
import type { DatasetSourceKind } from '@/domain/dataset/dataset.ts';
import { domainError } from '@/shared/errors/domain-error.ts';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import { err, ok } from '@/shared/result/result.ts';
import type { Result } from '@/shared/result/result.ts';

/**
 * Pre-ingestion validation of a chosen file.
 *
 * Everything decidable without touching the engine happens here, so an oversized or unsupported
 * file is refused before a single byte is read into the worker.
 *
 * The file is `unknown` on the way in. `File` is a DOM type and the application layer that calls
 * this must not assume a browser, so narrowing happens at this boundary.
 */

export interface ValidatedFile {
  file: File;
  /** Display text only. Never used to build an identifier, never used to name a relation. */
  fileName: string;
  byteSize: number;
  extension: string;
  sourceKind: DatasetSourceKind;
  /** Explicit delimiter where the sniffer is unreliable; `undefined` leaves detection to DuckDB. */
  delimiter: string | undefined;
}

/**
 * Structural check for a `File`.
 *
 * Duck-typed rather than `instanceof File` so the module stays testable outside a browser and does
 * not fail against a `File` from another realm.
 */
const isFileLike = (value: unknown): value is File =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as File).name === 'string' &&
  typeof (value as File).size === 'number' &&
  typeof (value as File).arrayBuffer === 'function';

/**
 * Validates the file against every pre-ingestion bound.
 *
 * The extension decides the parser. MIME type is not trusted for the decision: browsers report
 * `.csv` variously as `text/csv`, `application/vnd.ms-excel`, or an empty string depending on the
 * platform, so treating it as authoritative would reject valid files on some machines and not
 * others. The extension allowlist is the check that actually constrains which parser runs.
 */
export const validateImportFile = (file: unknown): Result<ValidatedFile, DomainError> => {
  if (!isFileLike(file)) {
    return err(domainError('IMPORT_FAILED', 'No readable file was supplied for import.'));
  }

  const extension = fileExtension(file.name);
  const sourceKind = ALLOWED_EXTENSIONS[extension];

  if (sourceKind === undefined) {
    return err(
      domainError('IMPORT_FAILED', `Only ${Object.keys(ALLOWED_EXTENSIONS).join(', ')} files can be imported.`, {
        allowedExtensions: Object.keys(ALLOWED_EXTENSIONS),
      }),
    );
  }

  if (file.size === 0) {
    return err(domainError('IMPORT_FAILED', 'The chosen file is empty.'));
  }

  if (file.size > MAX_FILE_BYTES) {
    return err(
      domainError('IMPORT_FAILED', `Files larger than ${formatByteBudget(MAX_FILE_BYTES)} cannot be imported.`, {
        maxBytes: MAX_FILE_BYTES,
      }),
    );
  }

  return ok({
    file,
    fileName: file.name,
    byteSize: file.size,
    extension,
    sourceKind,
    delimiter: DELIMITER_BY_EXTENSION[extension],
  });
};

/** Refuses a schema too wide for the schema panel and the table to present usefully. */
export const validateColumnCount = (columnCount: number): Result<void, DomainError> => {
  if (columnCount === 0) {
    return err(domainError('IMPORT_FAILED', 'The file contains no columns.'));
  }

  if (columnCount > MAX_COLUMN_COUNT) {
    return err(
      domainError('IMPORT_FAILED', `Files with more than ${MAX_COLUMN_COUNT} columns cannot be imported.`, {
        maxColumns: MAX_COLUMN_COUNT,
      }),
    );
  }

  return ok(undefined);
};

/**
 * The single import failure the engine reports for anything DuckDB raised.
 *
 * Privacy constraint. A DuckDB parser error quotes the offending line — `Error ... near "4,alice"` —
 * so interpolating it would put file contents into an error message that reaches both the UI and,
 * through the dispatcher, an agent. The engine's own message is dropped rather than forwarded.
 */
export const ingestionFailure = (): DomainError =>
  domainError('IMPORT_FAILED', 'The file could not be parsed. Check that it is well-formed and matches its extension.');
