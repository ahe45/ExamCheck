import AdmZip from "adm-zip";
import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";
import {
  PHOTO_ARCHIVE_MAX_ENTRIES,
  PHOTO_MAX_HEIGHT,
  PHOTO_MAX_PIXELS,
  PHOTO_MAX_WIDTH,
  WORKBOOK_MAX_ENTRIES,
  assertWorkbookBuffer,
  hasZipMagic,
  openValidatedPhotoArchive,
  readValidatedPhotoEntry,
  validatePhotoArchiveEntryMetadata,
  validatePhotoArchiveUploadFile,
  validateWorkbookArchiveEntryMetadata,
  validateWorkbookUploadFile,
  type CandidateUploadFile,
} from "./candidate-upload-security.js";

let workbookBuffer: Buffer;

beforeAll(async () => {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet("수험생").addRow(["수험번호"]);
  workbookBuffer = Buffer.from(await workbook.xlsx.writeBuffer());
});

describe("candidate upload file validation", () => {
  it("accepts a normal OOXML workbook with expected metadata", () => {
    expect(hasZipMagic(workbookBuffer)).toBe(true);
    expect(
      validateWorkbookUploadFile(uploadFile(workbookBuffer, "수험생 업로드 양식.xlsx", workbookMimeType)),
    ).toMatchObject({ originalname: "수험생 업로드 양식.xlsx" });
    expect(() => assertWorkbookBuffer(workbookBuffer)).not.toThrow();
  });

  it("rejects a workbook with a fake extension before parsing its contents", () => {
    expect(() =>
      validateWorkbookUploadFile(uploadFile(workbookBuffer, "수험생 업로드 양식.xls", workbookMimeType)),
    ).toThrow("XLSX 확장자의 파일을 선택해 주세요.");
  });

  it("rejects XLSX and ZIP uploads without a PK magic signature", () => {
    const invalid = Buffer.from("not-an-office-or-zip-file");
    expect(() => validateWorkbookUploadFile(uploadFile(invalid, "fake.xlsx", workbookMimeType))).toThrow(
      "XLSX 파일 형식이 올바르지 않습니다",
    );
    expect(() => validatePhotoArchiveUploadFile(uploadFile(invalid, "fake.zip", "application/zip"))).toThrow(
      "ZIP 파일 형식이 올바르지 않습니다",
    );
  });

  it("rejects metadata that explicitly describes a different file type", () => {
    expect(() => validateWorkbookUploadFile(uploadFile(workbookBuffer, "fake.xlsx", "image/png"))).toThrow(
      "XLSX 파일 형식을 확인해 주세요.",
    );
  });

  it("accepts a normal ZIP upload and a JPEG entry with matching signature", () => {
    const zipBuffer = photoArchive("10001.jpg", jpegBytes());
    expect(validatePhotoArchiveUploadFile(uploadFile(zipBuffer, "photos.zip", "application/zip"))).toMatchObject({
      originalname: "photos.zip",
    });

    const entries = openValidatedPhotoArchive(zipBuffer);
    const photo = readValidatedPhotoEntry(entries[0]!, "jpg");
    expect(photo).toMatchObject({ mimeType: "image/jpeg" });
  });

  it("recognizes a PNG only when its extension and signature agree", () => {
    const png = pngBytes(1, 1);
    const entries = openValidatedPhotoArchive(photoArchive("10001.png", png));
    expect(readValidatedPhotoEntry(entries[0]!, "png")).toMatchObject({ mimeType: "image/png" });
    expect(readValidatedPhotoEntry(entries[0]!, "jpg")).toBeNull();
  });

  it("rejects image dimensions and pixel counts that can exhaust decoders", () => {
    const tooWide = openValidatedPhotoArchive(photoArchive("wide.png", pngBytes(PHOTO_MAX_WIDTH + 1, 1)));
    expect(() => readValidatedPhotoEntry(tooWide[0]!, "png")).toThrow("최대 12,000×12,000 픽셀");

    const excessivePixels = openValidatedPhotoArchive(
      photoArchive("pixels.png", pngBytes(10_000, Math.floor(PHOTO_MAX_PIXELS / 10_000) + 1)),
    );
    expect(() => readValidatedPhotoEntry(excessivePixels[0]!, "png")).toThrow("총 픽셀 수");
    expect(PHOTO_MAX_HEIGHT).toBe(12_000);
  });

  it("skips signed image data when a valid dimension header is missing", () => {
    const truncatedPng = openValidatedPhotoArchive(
      photoArchive("truncated.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    );
    const truncatedJpeg = openValidatedPhotoArchive(photoArchive("truncated.jpg", Buffer.from([0xff, 0xd8, 0xff])));
    expect(readValidatedPhotoEntry(truncatedPng[0]!, "png")).toBeNull();
    expect(readValidatedPhotoEntry(truncatedJpeg[0]!, "jpg")).toBeNull();
  });
});

describe("workbook archive entry validation", () => {
  it("rejects a highly compressed OOXML entry before ExcelJS decompresses it", () => {
    const zip = requiredWorkbookArchive();
    zip.addFile("xl/sharedStrings.xml", Buffer.alloc(1024 * 1024, 0));
    expect(() => assertWorkbookBuffer(zip.toBuffer())).toThrow("압축률이 허용 범위를 초과했습니다");
  });

  it("rejects excessive entries and missing required OOXML structure", () => {
    const entries = Array.from({ length: WORKBOOK_MAX_ENTRIES + 1 }, (_, index) =>
      archiveEntry(`xl/items/${index}.xml`, 16, 16),
    );
    expect(() => validateWorkbookArchiveEntryMetadata(entries)).toThrow("최대 1,000개의 항목");
    expect(() => assertWorkbookBuffer(photoArchive("not-workbook.txt", Buffer.from("content")))).toThrow(
      "XLSX 필수 문서 구조",
    );
  });

  it("rejects invalid central-directory sizes before parsing XML", () => {
    const entries = requiredWorkbookEntries();
    entries.push(archiveEntry("xl/sharedStrings.xml", 16, 0));
    expect(() => validateWorkbookArchiveEntryMetadata(entries)).toThrow("XLSX 내부 압축 정보");
  });
});

describe("photo archive entry validation", () => {
  it.each(["../10001.jpg", "/10001.jpg", "C:/photos/10001.jpg", "folder/..\\10001.jpg", "bad\0name.jpg"])(
    "rejects unsafe archive path %s",
    (entryName) => {
      expect(() => validatePhotoArchiveEntryMetadata([archiveEntry(entryName, 16, 16)])).toThrow(
        "ZIP 파일에 안전하지 않은 경로가 포함되어 있습니다",
      );
    },
  );

  it("skips a file whose image extension disguises non-image content", () => {
    const entries = openValidatedPhotoArchive(photoArchive("10001.jpg", Buffer.from("plain text")));
    expect(readValidatedPhotoEntry(entries[0]!, "jpg")).toBeNull();
  });

  it("rejects a highly compressed entry before decompressing it", () => {
    const zipBuffer = photoArchive("10001.png", Buffer.alloc(1024 * 1024, 0));
    expect(() => openValidatedPhotoArchive(zipBuffer)).toThrow("압축률이 허용 범위를 초과했습니다");
  });

  it("rejects an archive with too many entries", () => {
    const entries = Array.from({ length: PHOTO_ARCHIVE_MAX_ENTRIES + 1 }, (_, index) =>
      archiveEntry(`${index}.jpg`, 16, 16),
    );
    expect(() => validatePhotoArchiveEntryMetadata(entries)).toThrow("최대 5,000개의 항목");
  });

  it("rejects a non-empty entry whose reported compressed size is zero", () => {
    expect(() => validatePhotoArchiveEntryMetadata([archiveEntry("10001.jpg", 16, 0)])).toThrow(
      "압축 정보가 올바르지 않습니다",
    );
  });
});

const workbookMimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function uploadFile(buffer: Buffer, originalname: string, mimetype: string): CandidateUploadFile {
  return { buffer, originalname, mimetype, size: buffer.length };
}

function photoArchive(entryName: string, content: Buffer) {
  const zip = new AdmZip();
  zip.addFile(entryName, content);
  return zip.toBuffer();
}

function requiredWorkbookArchive() {
  const zip = new AdmZip();
  zip.addFile("[Content_Types].xml", Buffer.from("<Types/>"));
  zip.addFile("_rels/.rels", Buffer.from("<Relationships/>"));
  zip.addFile("xl/workbook.xml", Buffer.from("<workbook/>"));
  zip.addFile("xl/_rels/workbook.xml.rels", Buffer.from("<Relationships/>"));
  zip.addFile("xl/worksheets/sheet1.xml", Buffer.from("<worksheet/>"));
  return zip;
}

function requiredWorkbookEntries() {
  return [
    archiveEntry("[Content_Types].xml", 16, 16),
    archiveEntry("_rels/.rels", 16, 16),
    archiveEntry("xl/workbook.xml", 16, 16),
    archiveEntry("xl/_rels/workbook.xml.rels", 16, 16),
    archiveEntry("xl/worksheets/sheet1.xml", 16, 16),
  ];
}

function jpegBytes(width = 1, height = 1) {
  return Buffer.from([
    0xff,
    0xd8,
    0xff,
    0xc0,
    0x00,
    0x0b,
    0x08,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x01,
    0x01,
    0x11,
    0x00,
    0xff,
    0xd9,
  ]);
}

function pngBytes(width: number, height: number) {
  const buffer = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write("IHDR", 12, "ascii");
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

function archiveEntry(entryName: string, size: number, compressedSize: number): AdmZip.IZipEntry {
  return {
    entryName,
    isDirectory: false,
    header: { size, compressedSize },
  } as unknown as AdmZip.IZipEntry;
}
