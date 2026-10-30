import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function nextPatchVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`Invalid release version: ${version}`);
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

export function advanceReleaseVersion(root) {
  const paths = ["package.json", "apps/api/package.json", "apps/web/package.json", "package-lock.json"];
  const documents = paths.map((path) => JSON.parse(readFileSync(join(root, path), "utf8")));
  const current = documents[0].version;
  const lock = documents[3];
  const versions = [...documents, ...["", "apps/api", "apps/web"].map((key) => lock.packages[key])];
  if (versions.some((document) => !document || document.version !== current)) {
    throw new Error("Project, workspace and lockfile versions must match before packaging.");
  }
  let version = nextPatchVersion(current);
  while (existsSync(join(root, "installer/output", `가번호 관리 시스템_v${version}.exe`))) {
    version = nextPatchVersion(version);
  }
  versions.forEach((document) => {
    document.version = version;
  });
  documents.forEach((document, index) =>
    writeFileSync(join(root, paths[index]), `${JSON.stringify(document, null, 2)}\n`),
  );
  return version;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const version = advanceReleaseVersion(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
  process.stdout.write(`Release version: ${version}\n`);
}
