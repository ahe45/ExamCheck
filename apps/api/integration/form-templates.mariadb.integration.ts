import type { Pool, RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "../src/auth/auth.types.js";
import type { SaveFormTemplateDto } from "../src/form-templates/form-templates.dto.js";
import { FormTemplatesService } from "../src/form-templates/form-templates.service.js";
import { createMariaDbIntegrationHarness, type MariaDbIntegrationHarness } from "../test-support/mariadb-harness.js";

const code = "FORM_TEMPLATE_INTEGRATION";

let harness: MariaDbIntegrationHarness;
let service: FormTemplatesService;
let actor: AuthenticatedUser;

beforeAll(async () => {
  harness = await createMariaDbIntegrationHarness();
  actor = await readSystemUser(harness.pool);
  service = new FormTemplatesService(harness.pool);
});

afterAll(async () => {
  if (harness) await harness.cleanup();
});

describe("form template persistence on MariaDB", () => {
  it("updates one row and exposes it only while active", async () => {
    const created = await service.save(templateInput({ name: "처음 저장" }), actor);
    expect(created).toMatchObject({ code, name: "처음 저장", active: true });
    expect(created).not.toHaveProperty("version");
    expect(created).not.toHaveProperty("lifecycleState");

    const updated = await service.save(
      templateInput({
        name: "수정 저장",
        description: "같은 행 수정",
        layout: { pages: [{ id: "updated-page" }] },
      }),
      actor,
    );
    expect(updated).toMatchObject({
      id: created.id,
      name: "수정 저장",
      description: "같은 행 수정",
      layout: { pages: [{ id: "updated-page" }] },
    });

    const [countRows] = await harness.pool.execute<Array<RowDataPacket & { count: number }>>(
      "SELECT COUNT(*) AS count FROM form_template WHERE code = ?",
      [code],
    );
    expect(Number(countRows[0]?.count)).toBe(1);

    const disabled = await service.updateActive(code, { active: false }, actor);
    expect(disabled).toMatchObject({ id: created.id, active: false });
    expect((await service.list(true)).some((template) => template.code === code)).toBe(false);

    const enabled = await service.updateActive(code, { active: true }, actor);
    expect(enabled).toMatchObject({ id: created.id, active: true });
    expect((await service.list(true)).some((template) => template.code === code)).toBe(true);
  }, 120_000);
});

function templateInput(overrides: Partial<SaveFormTemplateDto> = {}): SaveFormTemplateDto {
  return {
    code,
    name: "양식 통합 테스트",
    description: "양식 통합 테스트",
    category: "Integration",
    usageScope: "CANDIDATE",
    active: true,
    layout: { pages: [{ id: "page-1" }] },
    ...overrides,
  };
}

async function readSystemUser(pool: Pool): Promise<AuthenticatedUser> {
  const [rows] = await pool.execute<Array<RowDataPacket & { id: number }>>(
    "SELECT id FROM app_user WHERE login_id = 'system' LIMIT 1",
  );
  const id = Number(rows[0]?.id ?? 0);
  if (!id) throw new Error("Fresh migration did not create the system user.");
  return { id, loginId: "system", role: "ADMIN", admissionNames: [] };
}
