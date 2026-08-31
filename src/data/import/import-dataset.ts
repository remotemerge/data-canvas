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

// Validates a chosen file before reading it into the engine.

export interface ValidatedFile {
  file: File;
  // Display name only; never used for identifiers or relations.
  fileName: string;
  byteSize: number;
  extension: string;
  sourceKind: DatasetSourceKind;
  // Explicit delimiter; `undefined` lets DuckDB sniff it.
  delimiter: string | undefined;
}

// Checks File-like input without relying on a browser `File` constructor.
const isFileLike = (value: unknown): value is File =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as File).name === 'string' &&
  typeof (value as File).size === 'number' &&
  typeof (value as File).arrayBuffer === 'function';

// Validates file type and size limits before ingestion.
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

// Rejects schemas too wide for the UI.
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

// Maps DuckDB import errors to a value-free typed error.
export const ingestionFailure = (): DomainError =>
  domainError('IMPORT_FAILED', 'The file could not be parsed. Check that it is well-formed and matches its extension.');
