import type { Pool, PoolConnection } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import type { MutationAuditRepository } from "../common/audit/mutation-audit.repository.js";
import type { SaveFormTemplateDto } from "./form-templates.dto.js";
import type { FormTemplatesRepository } from "./form-templates.repository.js";
import { FormTemplatesService } from "./form-templates.service.js";

const developer: AuthenticatedUser = {
  id: 3,
  loginId: "dev",
  role: "DEVELOPER",
  admissionNames: [],
};

const safeInput: SaveFormTemplateDto = {
  code: "safe_test",
  name: "정상 양식",
  category: "테스트",
  usageScope: "CANDIDATE",
  active: true,
  layout: { pages: [{ settings: { documentHtml: "<p>정상 양식</p>" } }] },
};

function createFixture(existing: Record<string, unknown> | null = null) {
  const connection = {
    beginTransaction: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
    release: vi.fn(),
  } as unknown as PoolConnection;
  const pool = {
    getConnection: vi.fn().mockResolvedValue(connection),
  } as unknown as Pool;
  const saved = {
    id: Number(existing?.id ?? 8),
    code: "SAFE_TEST",
    name: safeInput.name,
    description: null,
    category: safeInput.category,
    usageScope: safeInput.usageScope,
    layout: safeInput.layout,
    active: true,
    createdAt: new Date("2026-08-28T00:00:00.000Z"),
    createdByLoginId: "dev",
  };
  const repository = {
    findForUpdate: vi.fn().mockResolvedValue(existing),
    restoreDeletedCode: vi.fn().mockResolvedValue(undefined),
    insert: vi.fn().mockResolvedValue(saved.id),
    update: vi.fn().mockResolvedValue(undefined),
    updateMetadata: vi.fn().mockResolvedValue(undefined),
    updateActive: vi.fn().mockResolvedValue(undefined),
    markDeleted: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue([saved]),
    findActive: vi.fn().mockResolvedValue(saved),
  } as unknown as FormTemplatesRepository;
  const audit = { record: vi.fn().mockResolvedValue(undefined) } as unknown as MutationAuditRepository;
  return { audit, connection, pool, repository, saved, service: new FormTemplatesService(pool, audit, repository) };
}

describe("FormTemplatesService", () => {
  it("rejects a risky layout before opening a transaction", async () => {
    const fixture = createFixture();
    const risky = {
      ...safeInput,
      layout: { pages: [{ settings: { documentHtml: '<script>alert(1)</script><img onload="alert(1)">' } }] },
    };

    await expect(fixture.service.save(risky, developer)).rejects.toThrow("위험 요소 2개를 제거");
    expect(fixture.pool.getConnection).not.toHaveBeenCalled();
  });

  it("inserts a new template without version fields", async () => {
    const fixture = createFixture();

    await expect(fixture.service.save(safeInput, developer)).resolves.toMatchObject({ code: "SAFE_TEST", id: 8 });
    expect(fixture.repository.insert).toHaveBeenCalledWith(fixture.connection, safeInput, "SAFE_TEST", developer.id);
    expect(fixture.repository.update).not.toHaveBeenCalled();
    expect(fixture.audit.record).toHaveBeenCalledWith(
      fixture.connection,
      expect.objectContaining({
        eventType: "FORM_TEMPLATE_SAVED",
        details: { code: "SAFE_TEST", templateId: 8, active: true, riskCount: 0 },
      }),
    );
    expect(fixture.connection.commit).toHaveBeenCalledOnce();
  });

  it("updates the existing row instead of creating another version", async () => {
    const existing = {
      id: 12,
      code: "SAFE_TEST",
      name: "이전 이름",
      description: null,
      category: "테스트",
      usageScope: "CANDIDATE",
      layout: {},
      active: true,
      deleted: false,
    };
    const fixture = createFixture(existing);

    await fixture.service.save(safeInput, developer);

    expect(fixture.repository.update).toHaveBeenCalledWith(fixture.connection, 12, safeInput);
    expect(fixture.repository.insert).not.toHaveBeenCalled();
  });

  it("changes availability on the same template row", async () => {
    const existing = {
      id: 12,
      code: "SAFE_TEST",
      name: "정상 양식",
      description: null,
      category: "테스트",
      usageScope: "CANDIDATE",
      layout: safeInput.layout,
      active: true,
      deleted: false,
    };
    const fixture = createFixture(existing);

    await fixture.service.updateActive("safe_test", { active: false }, developer);

    expect(fixture.repository.updateActive).toHaveBeenCalledWith(fixture.connection, 12, false);
    expect(fixture.repository.insert).not.toHaveBeenCalled();
  });
});
