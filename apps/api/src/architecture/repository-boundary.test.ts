import { readdir, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sourceRoot = resolve(process.cwd(), "src");
const infrastructureServiceExceptions = new Set(["auth/auth-audit.service.ts", "health/health.service.ts"]);

describe("API repository boundaries", () => {
  it("keeps direct SQL out of business services", async () => {
    const serviceFiles = (await listTypeScriptFiles(sourceRoot)).filter((file) => file.endsWith(".service.ts"));
    const violations: string[] = [];

    for (const file of serviceFiles) {
      const path = normalizePath(relative(sourceRoot, file));
      if (infrastructureServiceExceptions.has(path)) continue;
      const source = await readFile(file, "utf8");
      const callsDatabaseExecutor = /\b(?:pool|connection|executor)\.(?:execute|query)\s*(?:<|\()/.test(source);
      const containsSqlLiteral = /[`"]\s*(?:SELECT\b|INSERT\s+INTO\b|UPDATE\s+[a-z_]|DELETE\s+FROM\b)/i.test(source);
      if (callsDatabaseExecutor || containsSqlLiteral) violations.push(path);
    }

    expect(violations, "업무 서비스의 SQL은 repository로 이동해야 합니다.").toEqual([]);
  });

  it("keeps transaction ownership out of repositories", async () => {
    const repositoryFiles = (await listTypeScriptFiles(sourceRoot)).filter((file) => file.endsWith(".repository.ts"));
    const violations: string[] = [];

    for (const file of repositoryFiles) {
      const source = await readFile(file, "utf8");
      if (/\.(?:beginTransaction|commit|rollback)\s*\(/.test(source)) {
        violations.push(normalizePath(relative(sourceRoot, file)));
      }
    }

    expect(violations, "transaction은 service/application use case가 소유해야 합니다.").toEqual([]);
  });

  it("keeps domain modules independent from Nest and presentation DTOs", async () => {
    const domainFiles = (await listTypeScriptFiles(sourceRoot)).filter((file) => {
      const path = normalizePath(relative(sourceRoot, file));
      return /(?:^|\/)[^/]*(?:-domain|\.domain)\.ts$/.test(path);
    });
    const violations: string[] = [];

    for (const file of domainFiles) {
      const source = await readFile(file, "utf8");
      const importsNest = /from\s+["']@nestjs\//.test(source);
      const importsPresentationDto = /from\s+["'][^"']*\.dto(?:\.js)?["']/.test(source);
      if (importsNest || importsPresentationDto) violations.push(normalizePath(relative(sourceRoot, file)));
    }

    expect(violations, "domain은 Nest 및 presentation DTO에 의존하지 않아야 합니다.").toEqual([]);
  });

  it("keeps repositories independent from mutation audits and presentation DTOs", async () => {
    const repositoryFiles = (await listTypeScriptFiles(sourceRoot)).filter((file) => file.endsWith(".repository.ts"));
    const violations: string[] = [];

    for (const file of repositoryFiles) {
      const source = await readFile(file, "utf8");
      const importsMutationAudit = /from\s+["'][^"']*mutation-audit\.repository(?:\.js)?["']/.test(source);
      const importsPresentationDto = /from\s+["'][^"']*\.dto(?:\.js)?["']/.test(source);
      if (importsMutationAudit || importsPresentationDto) {
        violations.push(normalizePath(relative(sourceRoot, file)));
      }
    }

    expect(violations, "repository는 audit orchestration 및 presentation DTO에 의존하지 않아야 합니다.").toEqual([]);
  });
});

async function listTypeScriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = resolve(directory, entry.name);
      return entry.isDirectory() ? listTypeScriptFiles(path) : Promise.resolve(path.endsWith(".ts") ? [path] : []);
    }),
  );
  return nested.flat();
}

function normalizePath(path: string) {
  return path.replaceAll("\\", "/");
}
