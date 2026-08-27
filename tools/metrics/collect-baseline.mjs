import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "../..");

const metrics = {
  collectedAt: new Date().toISOString(),
  source: {
    api: await summarizeSource("apps/api/src", [".ts"], isProductionSource),
    web: await summarizeSource("apps/web/src", [".ts", ".tsx"], isProductionSource),
    apiTests: await summarizeSource("apps/api", [".ts"], isTestSource),
    webTests: await summarizeSource("apps/web", [".ts", ".tsx"], isTestSource),
    css: await summarizeSource("apps/web/src", [".css"], () => true),
  },
  migrations: await summarizeSource("apps/api/src/database/migrations", [".sql"], () => true),
  build: {
    apiBytes: await directoryBytes("apps/api/dist"),
    webBytes: await directoryBytes("apps/web/dist"),
    webAssets: await summarizeBuildAssets("apps/web/dist/assets"),
  },
};

process.stdout.write(`${JSON.stringify(metrics, null, 2)}\n`);

async function summarizeSource(directory, extensions, include) {
  const files = (await walkFiles(resolve(repositoryRoot, directory))).filter((file) => {
    const repositoryPath = relative(repositoryRoot, file).split(sep).join("/");
    return extensions.includes(extname(file)) && include(repositoryPath);
  });
  let lines = 0;
  let bytes = 0;
  for (const file of files) {
    const [content, fileStat] = await Promise.all([readFile(file, "utf8"), stat(file)]);
    lines += content.length === 0 ? 0 : content.split(/\r?\n/).length;
    bytes += fileStat.size;
  }
  return { files: files.length, lines, bytes };
}

async function summarizeBuildAssets(directory) {
  const files = await walkFiles(resolve(repositoryRoot, directory));
  const assets = [];
  for (const file of files) {
    const fileStat = await stat(file);
    assets.push({
      file: relative(repositoryRoot, file).split(sep).join("/"),
      bytes: fileStat.size,
    });
  }
  return assets.sort((left, right) => right.bytes - left.bytes || left.file.localeCompare(right.file));
}

async function directoryBytes(directory) {
  const files = await walkFiles(resolve(repositoryRoot, directory));
  let bytes = 0;
  for (const file of files) bytes += (await stat(file)).size;
  return bytes;
}

async function walkFiles(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "coverage" || entry.name === "setup") {
      continue;
    }
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walkFiles(path)));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function isProductionSource(path) {
  return !isTestSource(path) && !path.includes("/test-support/") && !path.includes("/integration/");
}

function isTestSource(path) {
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(path) || path.includes("/integration/") || path.includes("/http-e2e/");
}
