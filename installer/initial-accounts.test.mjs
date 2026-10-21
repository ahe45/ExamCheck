import { test } from "node:test";
import assert from "node:assert/strict";
import { readInitialPasswords, initialAccountEnvironment, clearInitialPasswords } from "./runtime/initial-accounts.mjs";

test("separate account passwords and fixed developer password reach bootstrap", () => {
  const settings = readInitialPasswords({
    adminPassword: "1234",
    userPassword: "User5678!",
    developerPassword: "ignored",
  });
  assert.deepEqual(initialAccountEnvironment(settings), {
    ADMIN_INITIAL_PASSWORD: "1234",
    USER_INITIAL_PASSWORD: "User5678!",
    DEVELOPER_INITIAL_PASSWORD: "control1@",
  });
});

for (const key of ["adminPassword", "userPassword"]) {
  for (const invalid of [undefined, null, 1234, "", "123", " 1234", "1234 ", "a".repeat(201)]) {
    test(`rejects invalid ${key}: ${JSON.stringify(invalid)}`, () => {
      assert.throws(
        () => readInitialPasswords({ adminPassword: "1234", userPassword: "5678", [key]: invalid }),
        /비밀번호/,
      );
    });
  }
}

test("legacy pending installations retain user passwords and use the fixed developer password", () => {
  assert.deepEqual(initialAccountEnvironment({ initialPassword: "legacy1234" }), {
    ADMIN_INITIAL_PASSWORD: "legacy1234",
    USER_INITIAL_PASSWORD: "legacy1234",
    DEVELOPER_INITIAL_PASSWORD: "control1@",
  });
  assert.deepEqual(readInitialPasswords({ password: "legacy1234" }), {
    adminInitialPassword: "legacy1234",
    userInitialPassword: "legacy1234",
  });
});

test("all temporary account passwords are removed after successful bootstrap", () => {
  const settings = {
    adminInitialPassword: "1234",
    userInitialPassword: "5678",
    initialPassword: "legacy1234",
    bootstrapped: true,
  };
  clearInitialPasswords(settings);
  assert.deepEqual(settings, { bootstrapped: true });
});
