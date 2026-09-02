import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "../src/auth/auth.types.js";
import { MutationAuditRepository } from "../src/common/audit/mutation-audit.repository.js";
import type { AppConfig } from "../src/config/app-config.js";
import { IdentityBackfillProjectionRepository } from "../src/database/identity-backfill-projection.repository.js";
import { DeveloperSettingsRepository } from "../src/developer-settings/developer-settings.repository.js";
import { DeveloperSettingsService } from "../src/developer-settings/developer-settings.service.js";
import { IdentityReadRouter } from "../src/identity-transition/identity-read-router.js";
import { IdentityShadowObservationRepository } from "../src/identity-transition/identity-shadow-observation.repository.js";
import { IdentityTransitionCoordinator } from "../src/identity-transition/identity-transition-coordinator.js";
import { IdentityTransitionStateRepository } from "../src/identity-transition/identity-transition-state.js";
import { createMariaDbIntegrationHarness, type MariaDbIntegrationHarness } from "../test-support/mariadb-harness.js";

const SHADOW_SECRET = "0123456789abcdef0123456789abcdef";

let harness: MariaDbIntegrationHarness;
let service: DeveloperSettingsService;
let actor: AuthenticatedUser;
let examCycleId: number;

interface IntegrationProfileRow extends RowDataPacket {
  academicYear: number;
  systemName: string;
  examineeScope: "SYSTEM" | "SCHEDULE";
  pseudonymScope: "ADMISSION" | "SCHEDULE";
}

beforeAll(async () => {
  harness = await createMariaDbIntegrationHarness();
  const [users] = await harness.pool.execute<Array<RowDataPacket & { id: number }>>(
    "SELECT id FROM app_user WHERE login_id = 'system' LIMIT 1",
  );
  actor = { id: Number(users[0]?.id), loginId: "system", role: "DEVELOPER", admissionNames: [] };

  const [profiles] = await harness.pool.execute<IntegrationProfileRow[]>(
    `SELECT academic_year AS academicYear, system_name AS systemName,
            examinee_no_uniqueness AS examineeScope,
            pseudonym_no_uniqueness AS pseudonymScope
     FROM system_profile WHERE id = 1`,
  );
  const profile = profiles[0];
  if (!profile) throw new Error("Integration system profile is missing.");

  const [cycleResult] = await harness.pool.execute<ResultSetHeader>(
    `INSERT INTO exam_cycle
      (system_profile_id, cycle_code, display_name, academic_year, status, created_by, updated_by)
     VALUES (1, 'identity-read-integration', ?, ?, 'ACTIVE', ?, ?)`,
    [profile.systemName, profile.academicYear, actor.id, actor.id],
  );
  examCycleId = Number(cycleResult.insertId);
  await harness.pool.execute(
    `INSERT INTO number_uniqueness_policy
      (exam_cycle_id, examinee_scope, pseudonym_scope, updated_by)
     VALUES (?, ?, ?, ?)`,
    [examCycleId, profile.examineeScope, profile.pseudonymScope, actor.id],
  );
  await harness.pool.execute(
    `UPDATE identity_transition_state
     SET write_mode = 'DUAL', read_mode = 'SHADOW', phase = 'SHADOWING', version = version + 1,
         updated_by = ? WHERE id = 1`,
    [actor.id],
  );

  const config = {
    identityTransition: { enabled: true, shadowHmacSecret: SHADOW_SECRET },
  } as Readonly<AppConfig>;
  const state = new IdentityTransitionStateRepository(config);
  const observations = new IdentityShadowObservationRepository();
  service = new DeveloperSettingsService(
    harness.pool,
    new MutationAuditRepository(),
    new DeveloperSettingsRepository(harness.pool),
    new IdentityTransitionCoordinator(state),
    new IdentityBackfillProjectionRepository(),
    new IdentityReadRouter(state, observations),
  );
});

afterAll(async () => {
  if (harness) await harness.cleanup();
});

describe("developer settings identity read routing on MariaDB", () => {
  it("records a matching shadow observation while returning the legacy policy", async () => {
    await expect(service.getForUser(actor)).resolves.toMatchObject({
      examineeNoUniqueness: "SYSTEM",
      pseudonymNoUniqueness: "ADMISSION",
    });

    const [observations] = await harness.pool.execute<
      Array<RowDataPacket & { matchCount: number; mismatchCount: number; sourceHighWaterMark: number }>
    >(
      `SELECT match_count AS matchCount, mismatch_count AS mismatchCount,
              source_high_water_mark AS sourceHighWaterMark
       FROM identity_shadow_observation
       WHERE observation_type = 'identity-live.developer-number-policy.v1'
       ORDER BY id DESC LIMIT 1`,
    );
    expect(observations[0]).toMatchObject({ matchCount: 1, mismatchCount: 0 });
    expect(Number(observations[0]?.sourceHighWaterMark)).toBeGreaterThanOrEqual(0);
  });

  it("returns the target policy only to a selected canary and records the mismatch", async () => {
    await harness.pool.execute(
      `UPDATE number_uniqueness_policy
       SET examinee_scope = 'SCHEDULE', pseudonym_scope = 'SCHEDULE'
       WHERE exam_cycle_id = ?`,
      [examCycleId],
    );
    await harness.pool.execute("INSERT INTO identity_canary_user (user_id) VALUES (?)", [actor.id]);
    await harness.pool.execute(
      `UPDATE identity_transition_state
       SET read_mode = 'CANARY', phase = 'CANARY', version = version + 1, updated_by = ?
       WHERE id = 1`,
      [actor.id],
    );

    await expect(service.getForUser(actor)).resolves.toMatchObject({
      examineeNoUniqueness: "SCHEDULE",
      pseudonymNoUniqueness: "SCHEDULE",
    });

    const [observations] = await harness.pool.execute<Array<RowDataPacket & { mismatchCount: number }>>(
      `SELECT mismatch_count AS mismatchCount
       FROM identity_shadow_observation
       WHERE observation_type = 'identity-live.developer-number-policy.v1'
       ORDER BY id DESC LIMIT 1`,
    );
    expect(Number(observations[0]?.mismatchCount)).toBe(1);
  });
});
