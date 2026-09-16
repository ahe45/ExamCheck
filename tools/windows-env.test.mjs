import assert from "node:assert/strict";
import { test } from "node:test";
import dotenv from "dotenv";
import { needsDatabaseSetup, updateEnvironment } from "./windows-env.mjs";

const settings = {
  DB_HOST: "127.0.0.1",
  DB_PORT: "3306",
  DB_NAME: "examcheck",
  DB_USER: "examcheck_app",
  DB_PASSWORD: "fixture-password",
};

test("new and previously copied empty settings require the setup prompt", () => {
  assert.equal(needsDatabaseSetup(""), true);
  assert.equal(needsDatabaseSetup(updateEnvironment("", { ...settings, DB_PASSWORD: "" })), true);
  assert.equal(
    needsDatabaseSetup(updateEnvironment("", { ...settings, DB_PASSWORD: "change-this-db-password" })),
    true,
  );
  assert.equal(needsDatabaseSetup(updateEnvironment("", settings)), false);
});

test("passwords with Korean, hash, quotes and literal backslashes round-trip through dotenv", () => {
  for (const password of [
    "한글#암호",
    "space at both ends ",
    "'single'\"double\"",
    "literal\\n\\r#value",
    "tick`#value",
    "$pass%word!&()=x",
  ]) {
    const result = updateEnvironment("DB_PASSWORD=old\n", { DB_PASSWORD: password });
    assert.equal(dotenv.parse(result).DB_PASSWORD, password);
  }
});

test("editing existing settings preserves unrelated values and removes stale duplicate assignments", () => {
  const source =
    '# Keep this comment\nPORT=3107\nJWT_SECRET="line1\nline2"\nDB_USER=old\nexport DB_USER=stale\nDB_PASSWORD=old\n';
  const result = updateEnvironment(source, settings);
  assert.deepEqual(dotenv.parse(result), { PORT: "3107", JWT_SECRET: "line1\nline2", ...settings });
  assert.ok(result.includes("# Keep this comment"));
  assert.ok(!result.includes("stale"));
  assert.ok(result.endsWith("\r\n"));
});

test("invalid payloads cannot overwrite other application settings or disclose supplied values", () => {
  for (const updates of [null, [], { JWT_SECRET: "private-value" }, { DB_PASSWORD: "private\nvalue" }]) {
    assert.throws(
      () => updateEnvironment("PORT=3100\n", updates),
      (error) => !error.message.includes("private"),
    );
  }
});
