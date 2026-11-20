/** Recovers UTF-8 filenames decoded as Latin-1 by multipart parsers. */
export function normalizeMultipartFileName(fileName: string) {
  if ([...fileName].some((character) => character.codePointAt(0)! > 0xff)) return fileName;

  const multipartBytes = Buffer.from(fileName, "latin1");
  const utf8FileName = multipartBytes.toString("utf8");
  if (utf8FileName.includes("\uFFFD") || !Buffer.from(utf8FileName, "utf8").equals(multipartBytes)) {
    return fileName;
  }
  return utf8FileName.normalize("NFC");
}
