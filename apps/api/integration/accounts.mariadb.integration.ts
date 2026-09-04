import type { RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AccountsApplicationService } from "../src/accounts/accounts.application.js";
import { AccountsRepository } from "../src/accounts/accounts.repository.js";
import type { AuthenticatedUser } from "../src/auth/auth.types.js";
import { MutationAuditRepository } from "../src/common/audit/mutation-audit.repository.js";
import { runWithRequestContext } from "../src/common/http/request-context.js";
import type { AppConfig } from "../src/config/app-config.js";
import { IdentityBackfillProjectionRepository } from "../src/database/identity-backfill-projection.repository.js";
import { IdentityTransitionCoordinator } from "../src/identity-transition/identity-transition-coordinator.js";
import { IdentityTransitionStateRepository } from "../src/identity-transition/identity-transition-state.js";
import { createMariaDbIntegrationHarness, type MariaDbIntegrationHarness } from "../test-support/mariadb-harness.js";

let harness: MariaDbIntegrationHarness;
let service: AccountsApplicationService;
let actor: AuthenticatedUser;

beforeAll(async () => {
  harness = await createMariaDbIntegrationHarness();
  const [rows] = await harness.pool.execute<Array<RowDataPacket & { id: number }>>(
    "SELECT id FROM app_user WHERE login_id = 'system' LIMIT 1",
  );
  actor = { id: Number(rows[0]?.id), loginId: "system", role: "ADMIN", admissionNames: [] };
  const state = new IdentityTransitionStateRepository({
    identityTransition: { enabled: false, shadowHmacSecret: null },
  } as Readonly<AppConfig>);
  service = new AccountsApplicationService(
    harness.pool,
    new AccountsRepository(),
    new MutationAuditRepository(),
    new IdentityTransitionCoordinator(state),
    new IdentityBackfillProjectionRepository(),
  );
});

afterAll(async () => {
  if (harness) await harness.cleanup();
});

describe("account writes on MariaDB", () => {
  it("creates a legacy-compatible account while identity transition is disabled", async () => {
    await expect(
      service.create(
        {
          loginId: "integration-account",
          password: "integration-password",
          role: "ADMIN",
          admissionNames: [],
        },
        actor,
      ),
    ).resolves.toMatchObject({ loginId: "integration-account", role: "ADMIN" });
  }, 120_000);

  it("creates an admission-scoped user account", async () => {
    const admissionName = `integration-admission-${Date.now()}`;
    await harness.pool.execute(
      `INSERT INTO candidate_record
        (track, admission, admission_code, series, unit_name, unit_code, exam_date, start_time,
         period_name, period_code, building_name, building_code, room_name, room_code,
         examinee_no, name, birth_date, exam_name, label_barcode, status)
       VALUES ('Integration', ?, 'INT', 'Integration', 'Integration', 'INT', '2026-11-01', '10:00',
               '1교시', 'INT-1', 'Integration', 'INT', 'Integration', 'INT-101',
               'INTEGRATION-001', 'Integration', '2000-01-01', 'Integration', 'EX-INTEGRATION-001', 'ACTIVE')`,
      [admissionName],
    );

    await expect(
      runWithRequestContext("f755469e-a6ad-42e1-b7c9-8b0c2ef5ed77", () =>
        service.create(
          {
            loginId: "integration-user-account",
            password: "integration-password",
            role: "USER",
            admissionNames: [admissionName],
          },
          actor,
        ),
      ),
    ).resolves.toMatchObject({
      loginId: "integration-user-account",
      role: "USER",
      admissionNames: [admissionName],
    });
  }, 120_000);
});
