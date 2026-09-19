import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import AdmZip from "adm-zip";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { candidateFields } from "./candidate-fields.js";
import { parseUploadInProcess } from "./candidate-parser-process.js";
describe("isolated upload parsing", () => {
  it("parses a workbook once and persists the validated rows", async () => {
    const directory = await mkdtemp(join(tmpdir(), "examcheck-parser-test-"));
    try {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("수험생");
      sheet.addRow(candidateFields.map((field) => field.label));
      sheet.addRow(candidateFields.map((field) => field.sample));
      const path = join(directory, "upload.xlsx");
      await workbook.xlsx.writeFile(path);
      await parseUploadInProcess("WORKBOOK", path, directory);
      const rows = JSON.parse(await readFile(join(directory, "parsed.json"), "utf8"));
      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBeTruthy();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 20000);
  it("persists photos separately and does not put image bytes in the manifest", async () => {
    const directory = await mkdtemp(join(tmpdir(), "examcheck-parser-test-"));
    try {
      const content = Buffer.alloc(24);
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(content);
      content.writeUInt32BE(13, 8);
      content.write("IHDR", 12);
      content.writeUInt32BE(2, 16);
      content.writeUInt32BE(2, 20);
      const zip = new AdmZip();
      zip.addFile("10001.png", content);
      zip.addFile("readme.txt", Buffer.from("ignored"));
      const path = join(directory, "upload.zip");
      await writeFile(path, zip.toBuffer());
      await parseUploadInProcess("PHOTO_ARCHIVE", path, directory);
      const parsed = JSON.parse(await readFile(join(directory, "parsed.json"), "utf8"));
      expect(parsed.files).toHaveLength(1);
      expect(parsed.skippedCount).toBe(1);
      expect(await readFile(parsed.files[0].contentPath)).toEqual(content);
      expect(parsed.files[0].content.data).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 20000);
});
