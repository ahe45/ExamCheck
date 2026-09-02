import { describe, expect, it, vi } from "vitest";
import { IdentityTransitionGateRepository } from "./identity-transition-gate.repository.js";
import { IDENTITY_SHADOW_OBSERVATION_TYPES } from "./identity-shadow-snapshot.repository.js";

describe("identity transition gate repository", () => {
  it("loads only the admission override or the cycle default range for each admission", async () => {
    const query = vi.fn().mockResolvedValue([[], []]);

    await new IdentityTransitionGateRepository().loadRangeValidationSnapshot({ query, execute: vi.fn() } as never);

    expect(query).toHaveBeenCalledTimes(3);
    const admissionSql = String(query.mock.calls[0]?.[0]);
    const slotSql = String(query.mock.calls[1]?.[0]);
    const segmentSql = String(query.mock.calls[2]?.[0]);
    expect(admissionSql).toContain("INNER JOIN pseudonym_policy effective_policy");
    expect(admissionSql).toContain("effective_policy.assignment_method IN ('DRAW', 'SEQUENTIAL')");
    expect(admissionSql).toContain("admission_policy.admission_id = admission.id");
    expect(slotSql).toContain("INNER JOIN pseudonym_policy effective_policy");
    expect(slotSql).toContain("effective_policy.assignment_method IN ('DRAW', 'SEQUENTIAL')");
    expect(slotSql).toContain("admission_policy.admission_id = admission.id");
    expect(segmentSql).toContain("INNER JOIN pseudonym_policy policy");
    expect(segmentSql).toContain("policy.assignment_method IN ('DRAW', 'SEQUENTIAL')");
    expect(segmentSql).toContain("policy.scope_kind = 'ADMISSION'");
    expect(segmentSql).toContain("policy.scope_kind = 'DEFAULT'");
    expect(segmentSql).toContain("NOT EXISTS");
    expect(segmentSql).toContain("admission_policy.admission_id = admission.id");
  });

  it("counts missing claims, assignment events, and print snapshots without selecting PII", async () => {
    const query = vi.fn().mockResolvedValue([[], []]);

    await new IdentityTransitionGateRepository().loadRelationshipInvariantAggregates({
      query,
      execute: vi.fn(),
    } as never);

    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("FROM pseudonym_assignment_event assignment_event");
    expect(sql).toContain("candidate_identity.status = 'ACTIVE'");
    expect(sql).toContain("registration.status = 'ACTIVE'");
    expect(sql).toContain("FROM candidate_number_claim required_claim");
    expect(sql).toContain("FROM pseudonym_number_claim required_claim");
    expect(sql).toContain("LEFT JOIN print_projection_snapshot snapshot");
    expect(sql).toContain("snapshot.projection_digest NOT REGEXP");
    expect(sql).not.toMatch(/candidate_identity\.name|birth_date|projection_json/i);
  });

  it("loads watermarks only from one latest complete all-domain batch", async () => {
    const batchId = "10000000-0000-4000-8000-000000000001";
    const execute = vi
      .fn()
      .mockResolvedValueOnce([[{ batchId }], []])
      .mockResolvedValueOnce([
        IDENTITY_SHADOW_OBSERVATION_TYPES.map((observationType) => ({
          observationType,
          sourceHighWaterMark: 42,
        })),
        [],
      ]);
    const repository = new IdentityTransitionGateRepository();

    const rows = await repository.loadLatestCompletedObservationWatermarks(
      { query: vi.fn(), execute } as never,
      new Date("2026-08-28T00:00:00Z"),
      IDENTITY_SHADOW_OBSERVATION_TYPES,
    );

    expect(rows).toHaveLength(IDENTITY_SHADOW_OBSERVATION_TYPES.length);
    expect(execute.mock.calls[0]?.[0]).toContain("batch.observation_count = ?");
    expect(execute.mock.calls[1]?.[1]?.[0]).toBe(batchId);
  });

  it("returns no watermark evidence when there is no complete batch", async () => {
    const execute = vi.fn().mockResolvedValue([[], []]);

    await expect(
      new IdentityTransitionGateRepository().loadLatestCompletedObservationWatermarks(
        { query: vi.fn(), execute } as never,
        new Date("2026-08-28T00:00:00Z"),
        IDENTITY_SHADOW_OBSERVATION_TYPES,
      ),
    ).resolves.toEqual([]);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("locks the shared source-mutation sequence before promotion", async () => {
    const execute = vi.fn().mockResolvedValue([[{ sourceHighWaterMark: 42 }], []]);

    await expect(
      new IdentityTransitionGateRepository().loadCurrentSourceMutationHighWaterMark({
        query: vi.fn(),
        execute,
      } as never),
    ).resolves.toBe(42);

    const sql = String(execute.mock.calls[0]?.[0]);
    expect(sql).toContain("identity_source_mutation_watermark");
    expect(sql).toContain("WHERE id = 1 FOR UPDATE");
    expect(sql).not.toMatch(/name|birth_date|details/i);
  });
});
