/**
 * Centralizes SQL identifier generation.
 *
 * Relation and column names come from generated IDs, not filenames, headers, or agent input. Values
 * use parameters separately.
 */

// Allowlisted identifier shape: lowercase ASCII, digits, underscore, and at most 63 characters.
export const SAFE_IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]{0,62}$/;

// Prefix for generated relation names.
const RELATION_PREFIX = 'dataset_';

// Hex characters retained from an entity ID.
const RELATION_HEX_LENGTH = 12;

export const isSafeIdentifier = (name: string): boolean => SAFE_IDENTIFIER_PATTERN.test(name);

// Derives a stable relation name from a generated dataset ID.
export const createRelationName = (datasetId: string): string => {
  const withoutPrefix = datasetId.slice(datasetId.indexOf('_') + 1);
  const hex = withoutPrefix.replace(/[^0-9a-f]/gi, '').toLowerCase();
  const padded = (hex + '0'.repeat(RELATION_HEX_LENGTH)).slice(0, RELATION_HEX_LENGTH);

  return `${RELATION_PREFIX}${padded}`;
};

// Quotes an allowlisted identifier for SQL.
export const quoteIdentifier = (name: string): string => {
  if (!isSafeIdentifier(name)) {
    // Do not include the rejected identifier; it may contain dataset content.
    throw new Error('Refusing to quote an identifier that does not match the safe-identifier allowlist.');
  }

  return `"${name.replaceAll('"', '""')}"`;
};

// Suffix for the transient staging relation used during import.
export const stagingRelationName = (relationName: string): string => `${relationName}_staging`;

// Returns the generated virtual path used to register an import buffer.
export const virtualImportPath = (stagingName: string): string => {
  if (!isSafeIdentifier(stagingName)) {
    throw new Error('Refusing to build an import path from a name outside the safe-identifier allowlist.');
  }

  return `${stagingName}.import`;
};

// Generates a positional physical column name for an imported column.
// Positional names keep duplicate headers distinct.
export const createColumnName = (ordinal: number): string => `c${ordinal}`;
