/**
 * Minimal dependency-free ZIP reader used by packaging regression tests to
 * inspect the contents of a built XPI without shelling out to a platform
 * `unzip` binary or adding a runtime zip-reading dependency.
 *
 * Only supports what `archiver`'s output actually produces: STORE (0) and
 * DEFLATE (8) compression, standard (non-Zip64) central directory records.
 */
import { inflateRawSync } from 'zlib';

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;

function findEndOfCentralDirectory(buf) {
  const maxCommentLength = 65535;
  const searchStart = Math.max(0, buf.length - 22 - maxCommentLength);
  for (let i = buf.length - 22; i >= searchStart; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIGNATURE) {
      return i;
    }
  }
  throw new Error('End of central directory record not found — not a valid zip file');
}

/**
 * Reads every entry in a zip archive into a Map of path -> decompressed Buffer.
 * Directory entries (paths ending in "/") are skipped.
 *
 * @param {Buffer} buf
 * @returns {Map<string, Buffer>}
 */
export function readZipEntries(buf) {
  const eocdOffset = findEndOfCentralDirectory(buf);
  const entryCount = buf.readUInt16LE(eocdOffset + 10);
  const centralDirOffset = buf.readUInt32LE(eocdOffset + 16);

  const entries = new Map();
  let offset = centralDirOffset;
  for (let i = 0; i < entryCount; i++) {
    if (buf.readUInt32LE(offset) !== CENTRAL_DIR_SIGNATURE) {
      throw new Error(`Expected central directory entry at offset ${offset}`);
    }
    const compressionMethod = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const fileNameLength = buf.readUInt16LE(offset + 28);
    const extraFieldLength = buf.readUInt16LE(offset + 30);
    const fileCommentLength = buf.readUInt16LE(offset + 32);
    const localHeaderOffset = buf.readUInt32LE(offset + 42);
    const fileName = buf.toString('utf8', offset + 46, offset + 46 + fileNameLength);

    if (!fileName.endsWith('/')) {
      entries.set(fileName, readLocalFileData(buf, localHeaderOffset, compressionMethod, compressedSize));
    }

    offset += 46 + fileNameLength + extraFieldLength + fileCommentLength;
  }

  return entries;
}

function readLocalFileData(buf, localHeaderOffset, compressionMethod, compressedSize) {
  if (buf.readUInt32LE(localHeaderOffset) !== LOCAL_FILE_SIGNATURE) {
    throw new Error(`Expected local file header at offset ${localHeaderOffset}`);
  }
  const fileNameLength = buf.readUInt16LE(localHeaderOffset + 26);
  const extraFieldLength = buf.readUInt16LE(localHeaderOffset + 28);
  const dataStart = localHeaderOffset + 30 + fileNameLength + extraFieldLength;
  const compressed = buf.subarray(dataStart, dataStart + compressedSize);

  if (compressionMethod === 0) return Buffer.from(compressed);
  if (compressionMethod === 8) return inflateRawSync(compressed);
  throw new Error(`Unsupported zip compression method: ${compressionMethod}`);
}
