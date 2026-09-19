import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadMigrationFiles, runMigrations } from "../src/database/migration-runner.js";
import { FormTemplatesRepository } from "../src/form-templates/form-templates.repository.js";
import { createMariaDbIntegrationHarness } from "../test-support/mariadb-harness.js";

const migrationDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../src/database/migrations");
const defaults = [
  {
    code: "FORM_MTJTTL30",
    name: "가번호 부여대장",
    digest: "efd2b3a19f762aea80b3b3ff6f36dffce7e028c6c01c6066202df7f3d3e3ab4a",
  },
  {
    code: "FORM_MTJTTL30_COPY",
    name: "결시자 명단",
    digest: "006e32d15406838ef9333f34cde62dc1f80c5ee9c305b2d0339cdb634aa3163b",
  },
  {
    code: "FORM_MTJTTL30_COPY_COPY",
    name: "수험생 사진대장",
    digest: "bac58988ca5fab964528f5619fa984f2ca88a2cf88bf37fed07ab980cdc99908",
  },
] as const;

describe("default operation form templates on MariaDB", () => {
  it("installs the exact saved layouts and respects later edits and deletions on setup reruns", async () => {
    const harness = await createMariaDbIntegrationHarness();
    try {
      const repository = new FormTemplatesRepository(harness.pool);
      expect((await repository.list(false)).map((template) => template.code).sort()).toEqual(
        defaults.map((template) => template.code).sort(),
      );
      for (const seed of defaults) {
        const template = await repository.findActive(seed.code);
        expect(template).toMatchObject({
          code: seed.code,
          name: seed.name,
          category: "기타",
          usageScope: "CANDIDATE",
          active: true,
          createdByLoginId: "system",
        });
        expect(createHash("sha256").update(JSON.stringify(template?.layout)).digest("hex")).toBe(seed.digest);
      }

      await harness.pool.execute("UPDATE form_template SET name = ?, active = FALSE WHERE code = ?", [
        "설치 후 수정한 양식",
        defaults[0].code,
      ]);
      await harness.pool.execute("DELETE FROM form_template WHERE code = ?", [defaults[1].code]);
      const connection = await harness.pool.getConnection();
      try {
        const result = await runMigrations(connection, await loadMigrationFiles(migrationDirectory));
        expect(result.applied).toEqual([]);
      } finally {
        connection.release();
      }
      const templates = await repository.list(false);
      expect(templates.find((template) => template.code === defaults[0].code)).toMatchObject({
        name: "설치 후 수정한 양식",
        active: false,
      });
      expect(templates.some((template) => template.code === defaults[1].code)).toBe(false);
    } finally {
      await harness.cleanup();
    }
  }, 120_000);

  it("preserves existing codes and names during upgrade and adds only missing forms", async () => {
    const harness = await createMariaDbIntegrationHarness({ migrateThrough: "049_history_reset_password.sql" });
    try {
      for (const [code, name] of [
        [defaults[0].code, "기존 수정본"],
        ["CUSTOM_ABSENT_LIST", defaults[1].name],
      ]) {
        await harness.pool.execute(
          `INSERT INTO form_template
             (code, name, description, category, usage_scope, layout_json, active, created_by)
           SELECT ?, ?, '기존 설명', '사용자 양식', 'ROOM', ?, FALSE, id
           FROM app_user WHERE login_id = 'system'`,
          [code, name, JSON.stringify({ pages: [{ id: "custom-page" }] })],
        );
      }
      const migrations = await loadMigrationFiles(migrationDirectory);
      const connection = await harness.pool.getConnection();
      try {
        const result = await runMigrations(connection, migrations);
        expect(result.applied).toEqual([
          "050_default_operation_form_templates.sql",
          "051_remove_legacy_default_form_templates.sql",
          "052_scoped_processing.sql",
          "053_processing_schema_comments.sql",
          "054_export_jobs.sql",
        ]);
        // The seed itself must also be safe to execute again without duplicate rows.
        await connection.query(
          migrations.find((migration) => migration.version === "050_default_operation_form_templates.sql")!.sql,
        );
      } finally {
        connection.release();
      }
      const templates = await new FormTemplatesRepository(harness.pool).list(false);
      for (const code of [defaults[0].code, "CUSTOM_ABSENT_LIST"]) {
        expect(templates.filter((template) => template.code === code)).toHaveLength(1);
        expect(templates.find((template) => template.code === code)).toMatchObject({
          description: "기존 설명",
          category: "사용자 양식",
          usageScope: "ROOM",
          active: false,
          layout: { pages: [{ id: "custom-page" }] },
        });
      }
      expect(templates.some((template) => template.code === defaults[1].code)).toBe(false);
      expect(templates.filter((template) => template.code === defaults[2].code)).toHaveLength(1);
      expect(templates.find((template) => template.code === defaults[2].code)).toMatchObject({
        name: defaults[2].name,
        active: true,
      });
    } finally {
      await harness.cleanup();
    }
  }, 120_000);

  it("removes only the two legacy default codes from existing installations", async () => {
    const harness = await createMariaDbIntegrationHarness({
      migrateThrough: "050_default_operation_form_templates.sql",
    });
    try {
      const repository = new FormTemplatesRepository(harness.pool);
      expect(await repository.list(false)).toHaveLength(5);
      await harness.pool.execute(
        `INSERT INTO form_template
           (code, name, category, usage_scope, layout_json, active, created_by)
         SELECT 'CUSTOM_SLIP', '가번호표', '사용자 양식', 'CANDIDATE', '{}', TRUE, id
         FROM app_user WHERE login_id = 'system'`,
      );
      await harness.pool.execute("UPDATE form_template SET name = ?, active = FALSE WHERE code = ?", [
        "사용자가 수정한 부여대장",
        defaults[0].code,
      ]);
      const before = (await repository.list(false)).filter(
        (template) => !["PSEUDONYM_SLIP", "CANDIDATE_CONFIRMATION"].includes(template.code),
      );
      const connection = await harness.pool.getConnection();
      try {
        const migrations = await loadMigrationFiles(migrationDirectory);
        const result = await runMigrations(connection, migrations);
        expect(result.applied).toEqual([
          "051_remove_legacy_default_form_templates.sql",
          "052_scoped_processing.sql",
          "053_processing_schema_comments.sql",
          "054_export_jobs.sql",
        ]);
        expect((await runMigrations(connection, migrations)).applied).toEqual([]);
      } finally {
        connection.release();
      }
      expect(await repository.list(false)).toEqual(before);
    } finally {
      await harness.cleanup();
    }
  }, 120_000);
});
