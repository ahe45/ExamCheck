import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scratchRoot = path.join(root, ".codex-tmp");
fs.mkdirSync(scratchRoot, { recursive: true });
const scratch = fs.mkdtempSync(path.join(scratchRoot, "editor-repack-"));
const target = path.join(scratch, "package");
fs.mkdirSync(target);
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}).`);
}
run("tar", ["-xf", "vendor/examlist-template-editor-1.1.13-examcheck.22.tgz", "--strip-components=1", "-C", target]);
run("git", [
  "-c",
  "core.autocrlf=false",
  "apply",
  "--directory=" + path.relative(root, target).replaceAll("\\", "/"),
  "vendor/patches/examcheck.23.patch",
]);
const metadata = JSON.parse(fs.readFileSync(path.join(target, "src/generated-artifact-fingerprints.json"), "utf8"));
for (const artifact of Object.values(metadata.artifacts)) {
  const actual =
    "sha256:" +
    createHash("sha256")
      .update(fs.readFileSync(path.join(target, artifact.output)))
      .digest("hex");
  if (actual !== artifact.artifactFingerprint) throw new Error(`Artifact checksum mismatch: ${artifact.output}`);
}
// Use npm's JS entry point directly so Windows needs no shell quoting.
const npmEntry =
  process.env.npm_execpath || path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
run(process.execPath, [npmEntry, "pack", target, "--pack-destination", path.join(root, "vendor"), "--ignore-scripts"]);
console.log("Rebuilt examlist-template-editor 1.1.13-examcheck.23. Temporary source:", target);
