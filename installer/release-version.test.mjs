import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { advanceReleaseVersion, nextPatchVersion } from "./release-version.mjs";

test("increments each release without reusing the previous version", () => {
  assert.equal(nextPatchVersion("0.1.8"), "0.1.9");
  assert.equal(nextPatchVersion("0.1.9"), "0.1.10");
  assert.throws(() => nextPatchVersion("invalid"));
});

test("updates all manifests and lockfile versions together and rejects mismatches", () => {
  const root = mkdtempSync(join(tmpdir(), "examcheck-release-"));
  try {
    for (const directory of ["apps/api", "apps/web"]) mkdirSync(join(root, directory), { recursive: true });
    const paths = ["package.json", "apps/api/package.json", "apps/web/package.json"];
    paths.forEach((path) => writeFileSync(join(root, path), JSON.stringify({ version: "0.1.8" })));
    writeFileSync(
      join(root, "package-lock.json"),
      JSON.stringify({
        version: "0.1.8",
        packages: Object.fromEntries(["", "apps/api", "apps/web"].map((key) => [key, { version: "0.1.8" }])),
      }),
    );
    assert.equal(advanceReleaseVersion(root), "0.1.9");
    mkdirSync(join(root, "installer/output"), { recursive: true });
    writeFileSync(join(root, "installer/output/가번호 관리 시스템_v0.1.10.exe"), "previous release");
    assert.equal(advanceReleaseVersion(root), "0.1.11");
    paths.forEach((path) => assert.equal(JSON.parse(readFileSync(join(root, path), "utf8")).version, "0.1.11"));
    const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
    assert.ok(Object.values(lock.packages).every((document) => document.version === "0.1.11"));
    writeFileSync(join(root, "apps/api/package.json"), JSON.stringify({ version: "0.1.1" }));
    assert.throws(() => advanceReleaseVersion(root), /must match/);
    assert.equal(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version, "0.1.11");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
