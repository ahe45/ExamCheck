import { BadRequestException } from "@nestjs/common";
import AdmZip from "adm-zip";

export interface CandidateUploadFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

export const WORKBOOK_UPLOAD_MAX_BYTES = 25 * 1024 * 1024;
export const WORKBOOK_MAX_ENTRIES = 1_000;
export const WORKBOOK_MAX_ENTRY_BYTES = 50 * 1024 * 1024;
export const WORKBOOK_MAX_TOTAL_BYTES = 100 * 1024 * 1024;
export const WORKBOOK_MAX_COMPRESSION_RATIO = 100;
export const PHOTO_ARCHIVE_UPLOAD_MAX_BYTES = 200 * 1024 * 1024;
export const PHOTO_ARCHIVE_MAX_ENTRIES = 5_000;
export const PHOTO_ARCHIVE_MAX_ENTRY_BYTES = 20 * 1024 * 1024;
export const PHOTO_ARCHIVE_MAX_TOTAL_BYTES = 500 * 1024 * 1024;
export const PHOTO_ARCHIVE_MAX_COMPRESSION_RATIO = 100;
export const PHOTO_MAX_WIDTH = 12_000;
export const PHOTO_MAX_HEIGHT = 12_000;
export const PHOTO_MAX_PIXELS = 40_000_000;

const workbookMimeTypes = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/zip",
  "application/x-zip-compressed",
  "application/octet-stream",
]);

const archiveMimeTypes = new Set([
  "application/zip",
  "application/x-zip-compressed",
  "application/x-compressed",
  "multipart/x-zip",
  "application/octet-stream",
]);

export function validateWorkbookUploadFile(file: CandidateUploadFile | undefined): CandidateUploadFile {
  if (!file) throw new BadRequestException("업로드할 XLSX 파일을 선택해 주세요.");
  const normalizedFile = normalizeUploadFileName(file);
  validateUploadMetadata(normalizedFile, ".xlsx", workbookMimeTypes, WORKBOOK_UPLOAD_MAX_BYTES, "XLSX");
  assertZipMagic(normalizedFile.buffer, "XLSX 파일 형식이 올바르지 않습니다. 올바른 업로드 양식을 선택해 주세요.");
  return normalizedFile;
}

export function validatePhotoArchiveUploadFile(file: CandidateUploadFile | undefined): CandidateUploadFile {
  if (!file) throw new BadRequestException("업로드할 사진 ZIP 파일을 선택해 주세요.");
  const normalizedFile = normalizeUploadFileName(file);
  validateUploadMetadata(normalizedFile, ".zip", archiveMimeTypes, PHOTO_ARCHIVE_UPLOAD_MAX_BYTES, "ZIP");
  assertZipMagic(normalizedFile.buffer, "ZIP 파일 형식이 올바르지 않습니다. 올바른 사진 압축 파일을 선택해 주세요.");
  return normalizedFile;
}

export function normalizeMultipartFileName(fileName: string) {
  if ([...fileName].some((character) => character.codePointAt(0)! > 0xff)) return fileName;

  const multipartBytes = Buffer.from(fileName, "latin1");
  const utf8FileName = multipartBytes.toString("utf8");
  if (utf8FileName.includes("\uFFFD") || !Buffer.from(utf8FileName, "utf8").equals(multipartBytes)) {
    return fileName;
  }
  return utf8FileName.normalize("NFC");
}

function normalizeUploadFileName(file: CandidateUploadFile): CandidateUploadFile {
  const originalname = normalizeMultipartFileName(file.originalname);
  return originalname === file.originalname ? file : { ...file, originalname };
}

export function assertWorkbookBuffer(buffer: Buffer) {
  assertZipMagic(buffer, "XLSX 파일 형식이 올바르지 않습니다. 올바른 업로드 양식을 선택해 주세요.");
  let entries: AdmZip.IZipEntry[];
  try {
    entries = new AdmZip(buffer).getEntries();
  } catch {
    throw new BadRequestException("XLSX 파일 구조를 읽을 수 없습니다. 파일이 손상되지 않았는지 확인해 주세요.");
  }
  validateWorkbookArchiveEntryMetadata(entries);
}

export function validateWorkbookArchiveEntryMetadata(entries: readonly AdmZip.IZipEntry[]) {
  if (entries.length > WORKBOOK_MAX_ENTRIES) {
    throw new BadRequestException(
      `XLSX 파일에는 최대 ${WORKBOOK_MAX_ENTRIES.toLocaleString("ko-KR")}개의 항목만 포함할 수 있습니다.`,
    );
  }

  let totalUncompressedSize = 0;
  let totalCompressedSize = 0;
  const entryNames = new Set<string>();
  for (const entry of entries) {
    assertSafeArchivePath(entry.entryName);
    const normalizedName = entry.entryName.replace(/\\/g, "/");
    entryNames.add(normalizedName);
    if (entry.isDirectory) continue;

    const uncompressedSize = safeArchiveSize(entry.header.size);
    const compressedSize = safeArchiveSize(entry.header.compressedSize);
    if (uncompressedSize > WORKBOOK_MAX_ENTRY_BYTES) {
      throw new BadRequestException("XLSX 내부의 개별 항목은 압축 해제 후 50MB를 넘을 수 없습니다.");
    }
    assertAcceptableCompression(uncompressedSize, compressedSize, WORKBOOK_MAX_COMPRESSION_RATIO, "XLSX");
    totalUncompressedSize += uncompressedSize;
    totalCompressedSize += compressedSize;
    if (!Number.isSafeInteger(totalUncompressedSize) || totalUncompressedSize > WORKBOOK_MAX_TOTAL_BYTES) {
      throw new BadRequestException("XLSX 파일은 압축 해제 후 전체 100MB를 넘을 수 없습니다.");
    }
  }

  assertAcceptableCompression(totalUncompressedSize, totalCompressedSize, WORKBOOK_MAX_COMPRESSION_RATIO, "XLSX");
  const requiredEntries = ["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels"];
  if (requiredEntries.some((entryName) => !entryNames.has(entryName))) {
    throw new BadRequestException("XLSX 필수 문서 구조가 없습니다. 올바른 업로드 양식을 선택해 주세요.");
  }
  if (![...entryNames].some((entryName) => /^xl\/worksheets\/sheet[^/]*\.xml$/i.test(entryName))) {
    throw new BadRequestException("XLSX 파일에서 워크시트 구조를 찾을 수 없습니다.");
  }
}

export function openValidatedPhotoArchive(buffer: Buffer): AdmZip.IZipEntry[] {
  assertZipMagic(buffer, "ZIP 파일 형식이 올바르지 않습니다. 올바른 사진 압축 파일을 선택해 주세요.");
  let zip: AdmZip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    throw new BadRequestException("ZIP 파일을 읽을 수 없습니다. 파일이 손상되지 않았는지 확인해 주세요.");
  }

  let entries: AdmZip.IZipEntry[];
  try {
    entries = zip.getEntries();
  } catch {
    throw new BadRequestException("ZIP 파일 목록을 확인할 수 없습니다. 파일이 손상되지 않았는지 확인해 주세요.");
  }
  validatePhotoArchiveEntryMetadata(entries);
  return entries;
}

export function validatePhotoArchiveEntryMetadata(entries: readonly AdmZip.IZipEntry[]) {
  if (entries.length > PHOTO_ARCHIVE_MAX_ENTRIES) {
    throw new BadRequestException(
      `ZIP 파일에는 폴더를 포함해 최대 ${PHOTO_ARCHIVE_MAX_ENTRIES.toLocaleString("ko-KR")}개의 항목만 넣을 수 있습니다.`,
    );
  }

  let totalUncompressedSize = 0;
  let totalCompressedSize = 0;
  for (const entry of entries) {
    assertSafeArchivePath(entry.entryName);
    if (entry.isDirectory) continue;

    const uncompressedSize = safeArchiveSize(entry.header.size);
    const compressedSize = safeArchiveSize(entry.header.compressedSize);
    if (uncompressedSize > PHOTO_ARCHIVE_MAX_ENTRY_BYTES) {
      throw new BadRequestException("ZIP 내부의 개별 파일은 20MB를 넘을 수 없습니다.");
    }
    assertAcceptableCompression(uncompressedSize, compressedSize, PHOTO_ARCHIVE_MAX_COMPRESSION_RATIO, "ZIP");

    totalUncompressedSize += uncompressedSize;
    totalCompressedSize += compressedSize;
    if (!Number.isSafeInteger(totalUncompressedSize) || totalUncompressedSize > PHOTO_ARCHIVE_MAX_TOTAL_BYTES) {
      throw new BadRequestException("압축을 푼 전체 파일 용량은 500MB를 넘을 수 없습니다.");
    }
  }

  if (
    totalUncompressedSize > 0 &&
    (totalCompressedSize === 0 || totalUncompressedSize / totalCompressedSize > PHOTO_ARCHIVE_MAX_COMPRESSION_RATIO)
  ) {
    throw new BadRequestException(
      "ZIP 파일의 전체 압축률이 허용 범위를 초과했습니다. 사진 원본으로 압축 파일을 다시 만들어 주세요.",
    );
  }
}

export function readValidatedPhotoEntry(entry: AdmZip.IZipEntry, extension: string) {
  let content: Buffer;
  try {
    content = entry.getData();
  } catch {
    throw new BadRequestException("ZIP 내부 파일을 읽을 수 없습니다. 압축 파일이 손상되지 않았는지 확인해 주세요.");
  }
  if (content.length !== entry.header.size || content.length > PHOTO_ARCHIVE_MAX_ENTRY_BYTES) {
    throw new BadRequestException("ZIP 내부 파일의 용량 정보가 올바르지 않습니다. 압축 파일을 다시 만들어 주세요.");
  }

  const normalizedExtension = extension.toLowerCase();
  if (normalizedExtension === "png" && hasPngSignature(content)) {
    const dimensions = readPngDimensions(content);
    if (!dimensions) return null;
    assertSafePhotoDimensions(dimensions);
    return { content, mimeType: "image/png" as const };
  }
  if ((normalizedExtension === "jpg" || normalizedExtension === "jpeg") && hasJpegSignature(content)) {
    const dimensions = readJpegDimensions(content);
    if (!dimensions) return null;
    assertSafePhotoDimensions(dimensions);
    return { content, mimeType: "image/jpeg" as const };
  }
  return null;
}

export function hasZipMagic(buffer: Buffer) {
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) return false;
  const marker = (buffer[2] << 8) | buffer[3];
  return marker === 0x0304 || marker === 0x0506 || marker === 0x0708;
}

export function hasPngSignature(buffer: Buffer) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return buffer.length >= signature.length && signature.every((byte, index) => buffer[index] === byte);
}

export function hasJpegSignature(buffer: Buffer) {
  return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

interface ImageDimensions {
  width: number;
  height: number;
}

function readPngDimensions(buffer: Buffer): ImageDimensions | null {
  if (buffer.length < 24 || buffer.readUInt32BE(8) !== 13 || buffer.toString("ascii", 12, 16) !== "IHDR") {
    return null;
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

function readJpegDimensions(buffer: Buffer): ImageDimensions | null {
  let offset = 2;
  while (offset + 1 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
    if (offset >= buffer.length) return null;

    const marker = buffer[offset];
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) return null;
    if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (offset + 2 > buffer.length) return null;

    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buffer.length) return null;
    if (isJpegStartOfFrame(marker)) {
      if (segmentLength < 7 || offset + 7 > buffer.length) return null;
      const height = buffer.readUInt16BE(offset + 3);
      const width = buffer.readUInt16BE(offset + 5);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    offset += segmentLength;
  }
  return null;
}

function isJpegStartOfFrame(marker: number) {
  return (
    (marker >= 0xc0 && marker <= 0xc3) ||
    (marker >= 0xc5 && marker <= 0xc7) ||
    (marker >= 0xc9 && marker <= 0xcb) ||
    (marker >= 0xcd && marker <= 0xcf)
  );
}

function assertSafePhotoDimensions({ width, height }: ImageDimensions) {
  if (width > PHOTO_MAX_WIDTH || height > PHOTO_MAX_HEIGHT) {
    throw new BadRequestException(
      `수험생 사진은 최대 ${PHOTO_MAX_WIDTH.toLocaleString("ko-KR")}×${PHOTO_MAX_HEIGHT.toLocaleString("ko-KR")} 픽셀까지 업로드할 수 있습니다.`,
    );
  }
  if (width > Math.floor(PHOTO_MAX_PIXELS / height)) {
    throw new BadRequestException(
      `수험생 사진의 총 픽셀 수는 ${PHOTO_MAX_PIXELS.toLocaleString("ko-KR")}픽셀을 넘을 수 없습니다.`,
    );
  }
}

function validateUploadMetadata(
  file: CandidateUploadFile,
  extension: string,
  allowedMimeTypes: ReadonlySet<string>,
  maxBytes: number,
  label: string,
) {
  const name = file.originalname.trim().toLowerCase();
  if (!name.endsWith(extension)) {
    throw new BadRequestException(`${label} 확장자의 파일을 선택해 주세요.`);
  }
  const mimeType = file.mimetype.split(";", 1)[0]?.trim().toLowerCase() || "";
  if (mimeType && !allowedMimeTypes.has(mimeType)) {
    throw new BadRequestException(`${label} 파일 형식을 확인해 주세요.`);
  }
  const reportedSize = Number.isFinite(file.size) && file.size >= 0 ? file.size : file.buffer.length;
  if (Math.max(reportedSize, file.buffer.length) > maxBytes) {
    const maxMegabytes = Math.floor(maxBytes / 1024 / 1024);
    throw new BadRequestException(`${label} 파일은 ${maxMegabytes}MB를 넘을 수 없습니다.`);
  }
}

function assertZipMagic(buffer: Buffer, message: string) {
  if (!hasZipMagic(buffer)) throw new BadRequestException(message);
}

function assertSafeArchivePath(entryName: string) {
  const normalized = entryName.replace(/\\/g, "/");
  const hasDriveRoot = /^[a-zA-Z]:\//.test(normalized);
  const hasTraversal = normalized.split("/").some((segment) => segment === "..");
  if (
    !normalized ||
    normalized.includes("\0") ||
    normalized.startsWith("/") ||
    normalized.startsWith("//") ||
    hasDriveRoot ||
    hasTraversal
  ) {
    throw new BadRequestException("ZIP 파일에 안전하지 않은 경로가 포함되어 있습니다. 압축 파일을 다시 만들어 주세요.");
  }
}

function safeArchiveSize(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new BadRequestException("ZIP 내부 압축 정보가 올바르지 않습니다. 압축 파일을 다시 만들어 주세요.");
  }
  return value;
}

function assertAcceptableCompression(
  uncompressedSize: number,
  compressedSize: number,
  maxCompressionRatio: number,
  label: "XLSX" | "ZIP",
) {
  if (uncompressedSize > 0 && compressedSize === 0) {
    throw new BadRequestException(`${label} 내부 압축 정보가 올바르지 않습니다. 압축 파일을 다시 만들어 주세요.`);
  }
  if (compressedSize > 0 && uncompressedSize / compressedSize > maxCompressionRatio) {
    throw new BadRequestException(
      label === "XLSX"
        ? "XLSX 내부 항목의 압축률이 허용 범위를 초과했습니다. 원본 파일을 다시 저장해 주세요."
        : "ZIP 내부 파일의 압축률이 허용 범위를 초과했습니다. 사진 원본으로 압축 파일을 다시 만들어 주세요.",
    );
  }
}
