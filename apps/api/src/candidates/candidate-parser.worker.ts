import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { crc32 } from "node:zlib";
import yauzl from "yauzl";
import type AdmZip from "adm-zip";
import { parseCandidateWorkbook } from "./candidate-workbook-parser.js";
import { readValidatedPhotoEntry, validatePhotoArchiveEntryMetadata } from "./candidate-upload-security.js";
import type { CandidatePhotoArchiveFiles } from "./candidate-domain.js";

process.once("message", async (message: { kind: "WORKBOOK" | "PHOTO_ARCHIVE"; path: string; directory: string }) => {
  try {
    const result =
      message.kind === "WORKBOOK"
        ? await parseCandidateWorkbook(await readFile(message.path))
        : await parsePhotos(message.path, message.directory);
    await writeFile(join(message.directory, "parsed.json"), JSON.stringify(result));
    process.send?.({ done: true });
  } catch (error) {
    process.send?.({ error: error instanceof Error ? error.message : "파일을 분석하지 못했습니다." });
  } finally {
    process.disconnect?.();
  }
});

async function parsePhotos(path: string, directory: string): Promise<CandidatePhotoArchiveFiles> {
  const zip = await yauzl.openPromise(path, { lazyEntries: true, autoClose: false, validateEntrySizes: true });
  try {
    const entries: yauzl.Entry[] = [];
    for await (const entry of zip.eachEntry()) {
      entries.push(entry);
      if (entries.length > 5000) throw new Error("ZIP 항목은 최대 5,000개까지 가능합니다.");
    }
    validatePhotoArchiveEntryMetadata(
      entries.map((entry) => ({
        entryName: entry.fileName,
        isDirectory: entry.fileName.endsWith("/"),
        header: { size: entry.uncompressedSize, compressedSize: entry.compressedSize },
      })) as AdmZip.IZipEntry[],
    );
    const archive: CandidatePhotoArchiveFiles = { files: [], totalFiles: 0, skippedCount: 0 };
    for (const entry of entries) {
      if (entry.fileName.endsWith("/")) continue;
      archive.totalFiles++;
      const fileName = entry.fileName.replace(/\\/g, "/").split("/").pop()!;
      const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
      if (!["png", "jpg", "jpeg"].includes(extension)) {
        archive.skippedCount++;
        continue;
      }
      const stream = await zip.openReadStreamPromise(entry);
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of stream) {
        bytes += chunk.length;
        if (bytes > 20 * 1024 * 1024) {
          stream.destroy();
          throw new Error("개별 사진의 압축 해제 크기가 20MB를 초과합니다.");
        }
        chunks.push(Buffer.from(chunk));
      }
      const content = Buffer.concat(chunks);
      if (crc32(content) !== entry.crc32) throw new Error("사진 ZIP의 무결성을 확인할 수 없습니다.");
      const validated = readValidatedPhotoEntry(
        { header: { size: entry.uncompressedSize }, getData: () => content } as AdmZip.IZipEntry,
        extension,
      );
      if (!validated) {
        archive.skippedCount++;
        continue;
      }
      const contentPath = join(directory, `photo-${archive.files.length}.bin`);
      await writeFile(contentPath, content);
      archive.files.push({
        fileName,
        mimeType: validated.mimeType,
        content: Buffer.alloc(0),
        contentPath,
        contentHash: createHash("sha256").update(content).digest("hex"),
      });
      process.send?.({ progress: archive.totalFiles, total: entries.length });
    }
    if (!archive.totalFiles) throw new Error("ZIP 파일에 사진 파일이 없습니다.");
    return archive;
  } finally {
    zip.close();
  }
}
