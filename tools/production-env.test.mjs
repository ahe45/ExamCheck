import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import dotenv from "dotenv";
import { ensureProductionSecret } from "./production-env.mjs";

test("replaces only the documented development key once and preserves database credentials", () => {
  const directory = mkdtempSync(join(tmpdir(), "examcheck-production-env-"));
  try {
    const path = join(directory, ".env");
    writeFileSync(path, "DB_PASSWORD='fixture#value'\nJWT_SECRET=replace-with-a-long-random-secret\n");
    const environment = { JWT_SECRET: "replace-with-a-long-random-secret" };
    assert.equal(ensureProductionSecret(path, environment), true);
    const saved = dotenv.parse(readFileSync(path));
    assert.equal(saved.DB_PASSWORD, "fixture#value");
    assert.equal(saved.JWT_SECRET, environment.JWT_SECRET);
    assert.equal(Buffer.from(saved.JWT_SECRET, "base64url").length, 48);
    assert.equal(ensureProductionSecret(path, environment), false);
    assert.equal(dotenv.parse(readFileSync(path)).JWT_SECRET, saved.JWT_SECRET);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
