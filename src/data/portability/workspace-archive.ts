/**
 * A minimal ZIP reader and writer for workspace archives.
 *
 * ZIP is used because it is the format a user can open with the tools they already have, which is
 * the point of a portable workspace. Entries are written with the `stored` method rather than
 * deflate: Parquet is already compressed, so deflating it buys almost nothing, and implementing or
 * importing an inflate path purely for the manifest and workspace JSON would add a dependency the
 * project's rules do not justify.
 *
 * The writer emits entries incrementally so a large export never assembles the whole archive in
 * memory. The reader is the untrusted direction and bounds everything it reads.
 */

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_SIGNATURE = 0x06054b50;

/** `stored`: bytes are written verbatim. The only method this module reads or writes. */
const METHOD_STORED = 0;

/** Marks the archive as requiring ZIP 2.0, the floor for the fields used here. */
const VERSION_NEEDED = 20;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/**
 * CRC-32 as ZIP specifies it.
 *
 * The table is built once on first use rather than at module load, so importing this module for the
 * reader alone does not pay for it.
 */
let crcTable: Uint32Array | null = null;

const crc32Table = (): Uint32Array => {
  if (crcTable !== null) return crcTable;
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  crcTable = table;

  return table;
};

export const crc32 = (bytes: Uint8Array, seed = 0): number => {
  const table = crc32Table();
  let crc = (seed ^ 0xffffffff) >>> 0;
  for (const byte of bytes) crc = (table[(crc ^ byte) & 0xff]! ^ (crc >>> 8)) >>> 0;

  return (crc ^ 0xffffffff) >>> 0;
};

interface CentralEntry {
  name: Uint8Array;
  crc: number;
  size: number;
  offset: number;
}

export interface ArchiveEntryInput {
  name: string;
  bytes: Uint8Array;
}

/**
 * Streams ZIP entries to a sink.
 *
 * `write` is called with each chunk as it is produced, so the caller decides whether it goes to a
 * File System Access writable stream, a download, or a buffer in a test. Nothing accumulates here
 * beyond the central directory, which holds one small record per file rather than any file content.
 */
export class ZipWriter {
  readonly #write: (chunk: Uint8Array) => Promise<void>;
  readonly #entries: CentralEntry[] = [];
  #offset = 0;

  constructor(write: (chunk: Uint8Array) => Promise<void>) {
    this.#write = write;
  }

  async #emit(chunk: Uint8Array): Promise<void> {
    await this.#write(chunk);
    this.#offset += chunk.byteLength;
  }

  /** Appends one stored entry. `bytes` is written as-is and not retained after the call. */
  async addEntry(name: string, bytes: Uint8Array): Promise<void> {
    const encodedName = textEncoder.encode(name);
    const crc = crc32(bytes);
    const offset = this.#offset;
    const header = new Uint8Array(30 + encodedName.byteLength);
    const view = new DataView(header.buffer);

    view.setUint32(0, LOCAL_HEADER_SIGNATURE, true);
    view.setUint16(4, VERSION_NEEDED, true);
    view.setUint16(6, 0, true);
    view.setUint16(8, METHOD_STORED, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, 0, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, bytes.byteLength, true);
    view.setUint32(22, bytes.byteLength, true);
    view.setUint16(26, encodedName.byteLength, true);
    view.setUint16(28, 0, true);
    header.set(encodedName, 30);

    await this.#emit(header);
    await this.#emit(bytes);
    this.#entries.push({ name: encodedName, crc, size: bytes.byteLength, offset });
  }

  /** Writes the central directory and terminator. The archive is complete once this resolves. */
  async finish(): Promise<void> {
    const start = this.#offset;

    for (const entry of this.#entries) {
      const record = new Uint8Array(46 + entry.name.byteLength);
      const view = new DataView(record.buffer);

      view.setUint32(0, CENTRAL_HEADER_SIGNATURE, true);
      view.setUint16(4, VERSION_NEEDED, true);
      view.setUint16(6, VERSION_NEEDED, true);
      view.setUint16(8, 0, true);
      view.setUint16(10, METHOD_STORED, true);
      view.setUint16(12, 0, true);
      view.setUint16(14, 0, true);
      view.setUint32(16, entry.crc, true);
      view.setUint32(20, entry.size, true);
      view.setUint32(24, entry.size, true);
      view.setUint16(28, entry.name.byteLength, true);
      view.setUint16(30, 0, true);
      view.setUint16(32, 0, true);
      view.setUint16(34, 0, true);
      view.setUint16(36, 0, true);
      view.setUint32(38, 0, true);
      view.setUint32(42, entry.offset, true);
      record.set(entry.name, 46);

      // eslint-disable-next-line no-await-in-loop
      await this.#emit(record);
    }

    const directorySize = this.#offset - start;
    const end = new Uint8Array(22);
    const view = new DataView(end.buffer);

    view.setUint32(0, END_OF_CENTRAL_SIGNATURE, true);
    view.setUint16(4, 0, true);
    view.setUint16(6, 0, true);
    view.setUint16(8, this.#entries.length, true);
    view.setUint16(10, this.#entries.length, true);
    view.setUint32(12, directorySize, true);
    view.setUint32(16, start, true);
    view.setUint16(20, 0, true);

    await this.#emit(end);
  }
}

export interface ReadArchiveOptions {
  maxFiles: number;
  /** Ceiling on the summed uncompressed size, checked as entries are read. The zip-bomb guard. */
  maxDecompressedBytes: number;
}

export class ArchiveFormatError extends Error {}

/**
 * Reads a stored-method ZIP into named byte ranges.
 *
 * Walks the local headers rather than the central directory. For an untrusted archive that is the
 * safer direction: the central directory points at arbitrary offsets, and honouring those pointers
 * is how a crafted archive gets a reader to interpret overlapping or out-of-bounds data. Walking
 * forward means every entry is read exactly where the previous one ended.
 */
export const readArchive = (bytes: Uint8Array, options: ReadArchiveOptions): Map<string, Uint8Array> => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = new Map<string, Uint8Array>();
  let offset = 0;
  let total = 0;

  while (offset + 4 <= bytes.byteLength && view.getUint32(offset, true) === LOCAL_HEADER_SIGNATURE) {
    if (offset + 30 > bytes.byteLength) throw new ArchiveFormatError('The archive ends inside an entry header.');

    const method = view.getUint16(offset + 8, true);
    const declaredCrc = view.getUint32(offset + 14, true);
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;

    if (method !== METHOD_STORED) {
      throw new ArchiveFormatError('The archive uses an unsupported compression method.');
    }
    if (dataStart + size > bytes.byteLength) {
      throw new ArchiveFormatError('The archive is truncated.');
    }

    total += size;
    if (entries.size >= options.maxFiles) throw new ArchiveFormatError('The archive contains too many files.');
    if (total > options.maxDecompressedBytes) throw new ArchiveFormatError('The archive is too large to import.');

    const name = textDecoder.decode(bytes.subarray(nameStart, nameStart + nameLength));
    const data = bytes.subarray(dataStart, dataStart + size);

    // Verified here as well as against the manifest checksum: this catches a corrupt archive before
    // any of its content is interpreted, including the manifest that carries the other checksums.
    if (crc32(data) !== declaredCrc) throw new ArchiveFormatError(`Entry '${name}' failed its integrity check.`);
    if (entries.has(name)) throw new ArchiveFormatError(`Entry '${name}' appears more than once.`);

    entries.set(name, data);
    offset = dataStart + size;
  }

  if (entries.size === 0) throw new ArchiveFormatError('The archive contains no entries.');

  return entries;
};
