/**
 * What an export contains.
 *
 * `definition-only` carries no dataset rows at all. It is the privacy-safe mode for sharing an
 * analysis structure, and the export dialog must say which mode includes data — an accidental
 * dataset disclosure through an ambiguous control would breach the product's central claim.
 */
export type ExportMode = 'definition-only' | 'full';

export const EXPORT_MODES: readonly ExportMode[] = ['definition-only', 'full'] as const;

/** Fixed archive member names. Import resolves paths against this list rather than trusting the archive. */
export const MANIFEST_ENTRY = 'manifest.json';
export const WORKSPACE_ENTRY = 'workspace.json';
export const DATA_PREFIX = 'data/';

/**
 * Bounds on an incoming archive.
 *
 * An archive is untrusted input: hand-edited, truncated, or shaped to exhaust memory on import.
 * Every limit here produces a refusal the user reads as a message rather than a hung tab. The
 * decompressed ceiling is the zip-bomb guard — a small archive claiming an enormous payload is
 * rejected while it inflates, not after.
 */
export const MAX_ARCHIVE_BYTES = 2 * 1024 * 1024 * 1024;
export const MAX_DECOMPRESSED_BYTES = 8 * 1024 * 1024 * 1024;
export const MAX_ARCHIVE_FILES = 256;
export const MAX_WORKSPACE_JSON_BYTES = 32 * 1024 * 1024;

/** Per-type entity ceilings, matching what the workspace itself can hold without degrading. */
export const MAX_ENTITIES_PER_TYPE = 2_000;

export interface ArchiveFileEntry {
  /** Archive-relative path. Always under `data/`; validated on read, never used as a filesystem path. */
  path: string;
  byteSize: number;
  /** Lowercase hex SHA-256 of the file's bytes, used to detect truncation or tampering. */
  checksum: string;
}

export interface ArchiveManifest {
  /**
   * The build that wrote the archive. Recorded for diagnostics only.
   *
   * Import does not negotiate versions. The project waives backward compatibility during active
   * development, so an archive from an incompatible build is rejected by entity validation rather
   * than by a version check that would imply a compatibility guarantee this project does not make.
   */
  appVersion: string;
  exportedAt: string;
  mode: ExportMode;
  counts: Record<string, number>;
  files: ArchiveFileEntry[];
  /** Checksum of `workspace.json`, kept separate because it is present in both export modes. */
  workspaceChecksum: string;
}

const HEX_64 = /^[0-9a-f]{64}$/;

/** Rejects a path that escapes `data/`, so a crafted entry cannot be read as anything else. */
export const isSafeDataPath = (path: string): boolean =>
  path.startsWith(DATA_PREFIX) &&
  !path.includes('..') &&
  !path.includes('\\') &&
  !path.startsWith(`${DATA_PREFIX}/`) &&
  path.length > DATA_PREFIX.length;

export const isChecksum = (value: unknown): value is string => typeof value === 'string' && HEX_64.test(value);

/**
 * Computes the checksum recorded in the manifest.
 *
 * SHA-256 via WebCrypto, which is available in every browser this application targets and needs no
 * dependency. This detects corruption and truncation; it is not a signature and does not establish
 * that an archive came from a trusted author, which is why import still validates every entity.
 */
export const computeChecksum = async (bytes: Uint8Array): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isFileEntry = (value: unknown): value is ArchiveFileEntry =>
  isRecord(value) &&
  typeof value['path'] === 'string' &&
  isSafeDataPath(value['path']) &&
  Number.isSafeInteger(value['byteSize']) &&
  (value['byteSize'] as number) >= 0 &&
  isChecksum(value['checksum']);

/**
 * Structural validation of a parsed manifest.
 *
 * Deliberately independent of Ajv: the manifest is read before any other archive member, so it must
 * be checkable without first loading a schema compiler, and the shape is small enough that a
 * hand-written guard is clearer than a schema. Entity payloads inside `workspace.json` still go
 * through the Ajv-backed domain validators.
 */
export const isArchiveManifest = (value: unknown): value is ArchiveManifest => {
  if (!isRecord(value)) return false;
  if (typeof value['appVersion'] !== 'string' || value['appVersion'].length > 100) return false;
  if (typeof value['exportedAt'] !== 'string' || value['exportedAt'].length > 40) return false;
  if (!EXPORT_MODES.includes(value['mode'] as ExportMode)) return false;
  if (!isRecord(value['counts'])) return false;
  if (!isChecksum(value['workspaceChecksum'])) return false;

  const files = value['files'];
  if (!Array.isArray(files) || files.length > MAX_ARCHIVE_FILES) return false;
  if (!files.every(isFileEntry)) return false;

  // A duplicated path would let a later entry shadow an earlier one after checksum verification.
  const paths = new Set(files.map((file) => (file as ArchiveFileEntry).path));

  return paths.size === files.length;
};
