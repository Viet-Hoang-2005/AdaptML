export interface ZipEntryInfo {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  compressionMethod: number;
  localHeaderOffset: number;
  isDirectory: boolean;
}

export interface ZipInspection {
  entries: ZipEntryInfo[];
  fileNames: string[];
}

interface ZipFileContent {
  name: string;
  data: Uint8Array;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const normalizeZipPath = (value: string) => value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
const toArrayBuffer = (bytes: Uint8Array) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

const findEndOfCentralDirectory = (view: DataView) => {
  const minOffset = Math.max(0, view.byteLength - 65557);
  for (let offset = view.byteLength - 22; offset >= minOffset; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      return offset;
    }
  }
  throw new Error('Invalid zip file: missing central directory.');
};

export const inspectZipFile = async (file: File): Promise<ZipInspection> => {
  const buffer = await file.arrayBuffer();
  const view = new DataView(buffer);
  const eocdOffset = findEndOfCentralDirectory(view);
  const entryCount = view.getUint16(eocdOffset + 10, true);
  let offset = view.getUint32(eocdOffset + 16, true);
  const entries: ZipEntryInfo[] = [];

  for (let index = 0; index < entryCount; index += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error('Invalid zip file: malformed central directory.');
    }

    const compressionMethod = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const fileNameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const nameBytes = new Uint8Array(buffer, offset + 46, fileNameLength);
    const name = normalizeZipPath(textDecoder.decode(nameBytes));

    entries.push({
      name,
      compressedSize,
      uncompressedSize,
      compressionMethod,
      localHeaderOffset,
      isDirectory: name.endsWith('/'),
    });

    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return {
    entries,
    fileNames: entries.map((entry) => entry.name),
  };
};

const getCompressedEntryBytes = (buffer: ArrayBuffer, entry: ZipEntryInfo) => {
  const view = new DataView(buffer);
  const offset = entry.localHeaderOffset;
  if (view.getUint32(offset, true) !== 0x04034b50) {
    throw new Error(`Invalid zip file: malformed local header for ${entry.name}.`);
  }
  const fileNameLength = view.getUint16(offset + 26, true);
  const extraLength = view.getUint16(offset + 28, true);
  const dataOffset = offset + 30 + fileNameLength + extraLength;
  return new Uint8Array(buffer, dataOffset, entry.compressedSize);
};

const inflateRaw = async (bytes: Uint8Array) => {
  const streamCtor = globalThis.DecompressionStream;
  if (!streamCtor) {
    throw new Error('This browser cannot preview compressed zip entries. Use an uncompressed zip or submit without editing.');
  }
  const stream = new streamCtor('deflate-raw' as CompressionFormat);
  const writer = stream.writable.getWriter();
  await writer.write(toArrayBuffer(bytes));
  await writer.close();
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
};

export const readZipEntryText = async (file: File, entryName: string, entries?: ZipEntryInfo[]) => {
  const normalizedEntryName = normalizeZipPath(entryName);
  const buffer = await file.arrayBuffer();
  const zipEntries = entries ?? (await inspectZipFile(file)).entries;
  const entry = zipEntries.find((item) => normalizeZipPath(item.name) === normalizedEntryName && !item.isDirectory);
  if (!entry) {
    throw new Error(`Entry point ${entryName} was not found in source.zip.`);
  }

  const compressedBytes = getCompressedEntryBytes(buffer, entry);
  if (entry.compressionMethod === 0) {
    return textDecoder.decode(compressedBytes);
  }
  if (entry.compressionMethod === 8) {
    return textDecoder.decode(await inflateRaw(compressedBytes));
  }
  throw new Error(`Cannot preview ${entryName}: unsupported zip compression method ${entry.compressionMethod}.`);
};

const crcTable = new Uint32Array(256).map((_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

const crc32 = (bytes: Uint8Array) => {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const dosTime = () => {
  const now = new Date();
  return ((now.getHours() & 0x1f) << 11) | ((now.getMinutes() & 0x3f) << 5) | (Math.floor(now.getSeconds() / 2) & 0x1f);
};

const dosDate = () => {
  const now = new Date();
  return (((now.getFullYear() - 1980) & 0x7f) << 9) | (((now.getMonth() + 1) & 0x0f) << 5) | (now.getDate() & 0x1f);
};

const writeUint16 = (target: Uint8Array, offset: number, value: number) => {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
};

const writeUint32 = (target: Uint8Array, offset: number, value: number) => {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
  target[offset + 2] = (value >>> 16) & 0xff;
  target[offset + 3] = (value >>> 24) & 0xff;
};

export const buildStoredZip = (files: ZipFileContent[], filename = 'source.zip') => {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  const time = dosTime();
  const date = dosDate();

  for (const file of files) {
    const name = normalizeZipPath(file.name);
    const nameBytes = textEncoder.encode(name);
    const data = file.data;
    const crc = crc32(data);
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const centralHeader = new Uint8Array(46 + nameBytes.length);

    writeUint32(localHeader, 0, 0x04034b50);
    writeUint16(localHeader, 4, 20);
    writeUint16(localHeader, 10, time);
    writeUint16(localHeader, 12, date);
    writeUint32(localHeader, 14, crc);
    writeUint32(localHeader, 18, data.length);
    writeUint32(localHeader, 22, data.length);
    writeUint16(localHeader, 26, nameBytes.length);
    localHeader.set(nameBytes, 30);

    writeUint32(centralHeader, 0, 0x02014b50);
    writeUint16(centralHeader, 4, 20);
    writeUint16(centralHeader, 6, 20);
    writeUint16(centralHeader, 12, time);
    writeUint16(centralHeader, 14, date);
    writeUint32(centralHeader, 16, crc);
    writeUint32(centralHeader, 20, data.length);
    writeUint32(centralHeader, 24, data.length);
    writeUint16(centralHeader, 28, nameBytes.length);
    writeUint32(centralHeader, 42, offset);
    centralHeader.set(nameBytes, 46);

    localParts.push(localHeader, data);
    centralParts.push(centralHeader);
    offset += localHeader.length + data.length;
  }

  const centralDirectorySize = centralParts.reduce((total, part) => total + part.length, 0);
  const eocd = new Uint8Array(22);
  writeUint32(eocd, 0, 0x06054b50);
  writeUint16(eocd, 8, files.length);
  writeUint16(eocd, 10, files.length);
  writeUint32(eocd, 12, centralDirectorySize);
  writeUint32(eocd, 16, offset);

  const blobParts = [...localParts, ...centralParts, eocd].map(toArrayBuffer);
  return new File(blobParts, filename, { type: 'application/zip' });
};

export const rebuildZipWithEditedEntry = async (file: File, entryName: string, text: string) => {
  const inspection = await inspectZipFile(file);
  const buffer = await file.arrayBuffer();
  const normalizedEntryName = normalizeZipPath(entryName);
  const files: ZipFileContent[] = [];
  let replaced = false;

  for (const entry of inspection.entries) {
    if (entry.isDirectory) continue;
    const normalizedName = normalizeZipPath(entry.name);
    if (normalizedName === normalizedEntryName) {
      files.push({ name: normalizedName, data: textEncoder.encode(text) });
      replaced = true;
      continue;
    }
    const compressedBytes = getCompressedEntryBytes(buffer, entry);
    if (entry.compressionMethod === 0) {
      files.push({ name: normalizedName, data: new Uint8Array(compressedBytes) });
    } else if (entry.compressionMethod === 8) {
      files.push({ name: normalizedName, data: await inflateRaw(compressedBytes) });
    } else {
      throw new Error(`Cannot rebuild zip: unsupported compression method ${entry.compressionMethod} for ${entry.name}.`);
    }
  }

  if (!replaced) {
    throw new Error(`Cannot rebuild zip: ${entryName} was not found.`);
  }

  return buildStoredZip(files, file.name || 'source.zip');
};

export const downloadFile = (file: File) => {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = file.name;
  anchor.click();
  URL.revokeObjectURL(url);
};
