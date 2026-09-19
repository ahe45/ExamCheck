import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { updateEnvironment } from "./windows-env.mjs";

export function ensureProductionSecret(path, environment) {
  if (
    ![undefined, "", "replace-with-a-long-random-secret", "examcheck-development-secret-change-me"].includes(
      environment.JWT_SECRET?.trim(),
    )
  )
    return false;
  const source = readFileSync(path, "utf8");
  const secret = randomBytes(48).toString("base64url");
  const updated = updateEnvironment(source, { JWT_SECRET: secret }, ["JWT_SECRET"]);
  const temporary = `${path}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    writeFileSync(temporary, updated, { mode: 0o600, flag: "wx" });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
  environment.JWT_SECRET = secret;
  console.log("운영 서버용 로그인 서명 키를 준비했습니다. 기존 로그인은 다시 진행해 주세요.");
  return true;
}
