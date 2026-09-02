import { pathToFileURL } from "node:url";
import {
  IdentityTransitionGateService,
  identityTransitionEvidenceTypes,
  type CreateTransitionRequestInput,
  type EmergencyRollbackInput,
  type IdentityTransitionApprovalType,
  type RecordTransitionEvidenceInput,
} from "../identity-transition/identity-transition-gate.service.js";
import { loadDatabaseCliConfig, reportDatabaseCliFailure, withDatabaseConnection } from "./database-cli-runtime.js";

type IdentityTransitionCliOptions =
  | { command: "record-evidence"; confirmIsolatedCopy: boolean; input: RecordTransitionEvidenceInput }
  | { command: "request"; confirmIsolatedCopy: boolean; input: CreateTransitionRequestInput }
  | {
      command: "attach-evidence";
      confirmIsolatedCopy: boolean;
      input: { requestId: string; evidenceId: string; actorUserId: number };
    }
  | {
      command: "approve";
      confirmIsolatedCopy: boolean;
      input: { requestId: string; approvalType: IdentityTransitionApprovalType; approvedBy: number };
    }
  | {
      command: "apply";
      confirmIsolatedCopy: boolean;
      input: { requestId: string; actorUserId: number; manualCanonicalConfirmation: boolean };
    }
  | { command: "rollback"; confirmIsolatedCopy: boolean; input: EmergencyRollbackInput };

async function main(): Promise<void> {
  const options = parseIdentityTransitionCliOptions(process.argv.slice(2));
  const config = loadDatabaseCliConfig();
  assertIsolatedTransitionExecution(config.database, options.confirmIsolatedCopy);
  const service = new IdentityTransitionGateService();
  const result = await withDatabaseConnection(config, { createDatabase: false }, async (connection) => {
    switch (options.command) {
      case "record-evidence":
        return service.recordEvidence(connection, options.input);
      case "request":
        return service.createRequest(connection, options.input);
      case "attach-evidence":
        await service.attachEvidence(connection, options.input);
        return { attached: true };
      case "approve":
        await service.approveRequest(connection, options.input);
        return { approved: true };
      case "apply":
        return service.applyRequest(connection, options.input);
      case "rollback":
        return service.emergencyRollback(connection, options.input);
    }
  });
  console.log(JSON.stringify(result, null, 2));
}

export function parseIdentityTransitionCliOptions(arguments_: readonly string[]): IdentityTransitionCliOptions {
  const [command, ...rawOptions] = arguments_;
  if (!isCommand(command)) throw new TypeError("Identity transition CLI requires a supported command.");
  const { values, flags } = parseOptions(rawOptions);
  const confirmIsolatedCopy = flags.delete("confirm-isolated-copy");

  let parsed: IdentityTransitionCliOptions;
  switch (command) {
    case "record-evidence": {
      const evidenceType = required(values, "type");
      if (!(identityTransitionEvidenceTypes as readonly string[]).includes(evidenceType)) {
        throw new TypeError("Identity transition evidence type is invalid.");
      }
      const elapsed = optionalPositiveInteger(values, "elapsed-minutes");
      const evidenceId = optional(values, "evidence-id");
      parsed = {
        command,
        confirmIsolatedCopy,
        input: {
          ...(evidenceId ? { evidenceId } : {}),
          evidenceType: evidenceType as RecordTransitionEvidenceInput["evidenceType"],
          result: enumValue(required(values, "result"), ["PASSED", "FAILED"] as const, "evidence result"),
          referenceCode: required(values, "reference"),
          ...(elapsed === undefined ? {} : { elapsedMinutes: elapsed }),
          observedAt: dateValue(required(values, "observed-at"), "observed-at"),
          validUntil: dateValue(required(values, "valid-until"), "valid-until"),
          recordedBy: positiveInteger(values, "recorded-by"),
          verifiedBy: positiveInteger(values, "verified-by"),
        },
      };
      break;
    }
    case "request": {
      const targetStage = enumValue(
        required(values, "target"),
        ["DUAL", "SHADOW", "CANARY", "CANONICAL"] as const,
        "target stage",
      );
      const minimumComparedEntityCount = optionalPositiveInteger(values, "min-compared-entities");
      const minimumObservationMinutes = optionalPositiveInteger(values, "min-observation-minutes");
      const requestId = optional(values, "request-id");
      parsed = {
        command,
        confirmIsolatedCopy,
        input: {
          ...(requestId ? { requestId } : {}),
          targetStage,
          expectedStateVersion: positiveInteger(values, "expected-version"),
          reasonCode: required(values, "reason"),
          ...(minimumComparedEntityCount === undefined ? {} : { minimumComparedEntityCount }),
          ...(minimumObservationMinutes === undefined ? {} : { minimumObservationMinutes }),
          maximumRollbackMinutes: positiveInteger(values, "max-rollback-minutes"),
          requestedBy: positiveInteger(values, "requested-by"),
        },
      };
      break;
    }
    case "attach-evidence":
      parsed = {
        command,
        confirmIsolatedCopy,
        input: {
          requestId: required(values, "request"),
          evidenceId: required(values, "evidence"),
          actorUserId: positiveInteger(values, "actor"),
        },
      };
      break;
    case "approve":
      parsed = {
        command,
        confirmIsolatedCopy,
        input: {
          requestId: required(values, "request"),
          approvalType: enumValue(
            required(values, "kind"),
            ["OPERATIONS", "DATA_OWNER", "PRIVACY", "CANONICAL_OWNER"] as const,
            "approval type",
          ),
          approvedBy: positiveInteger(values, "actor"),
        },
      };
      break;
    case "apply":
      parsed = {
        command,
        confirmIsolatedCopy,
        input: {
          requestId: required(values, "request"),
          actorUserId: positiveInteger(values, "actor"),
          manualCanonicalConfirmation: flags.delete("confirm-canonical-manual"),
        },
      };
      break;
    case "rollback": {
      const maximumRollbackMinutes = optionalPositiveInteger(values, "max-rollback-minutes");
      const evidence = optional(values, "evidence");
      parsed = {
        command,
        confirmIsolatedCopy,
        input: {
          target: enumValue(required(values, "to"), ["LEGACY", "DUAL"] as const, "rollback target"),
          actorUserId: positiveInteger(values, "actor"),
          reasonCode: required(values, "reason"),
          ...(maximumRollbackMinutes === undefined ? {} : { maximumRollbackMinutes }),
          ...(evidence === undefined
            ? {}
            : {
                evidenceIds: evidence
                  .split(",")
                  .map((value) => value.trim())
                  .filter(Boolean),
              }),
        },
      };
      break;
    }
  }

  if (values.size > 0 || flags.size > 0) {
    throw new TypeError("Identity transition CLI received unknown or duplicate options.");
  }
  return parsed;
}

export function assertIsolatedTransitionExecution(databaseName: string, confirmed: boolean): void {
  if (!confirmed) {
    throw new Error("Identity transition changes are blocked until --confirm-isolated-copy is provided.");
  }
  if (!/(?:^|[_-])(it|test|shadow|sandbox|staging|refactor)(?:[_-]|$)/i.test(databaseName)) {
    throw new Error(
      "Identity transition CLI only accepts an explicitly named isolated database copy. " +
        "Operational database execution is intentionally unavailable.",
    );
  }
}

function parseOptions(arguments_: readonly string[]): { values: Map<string, string>; flags: Set<string> } {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (const argument of arguments_) {
    if (!argument.startsWith("--")) throw new TypeError("Identity transition CLI options must start with --.");
    const separator = argument.indexOf("=");
    if (separator < 0) {
      const flag = argument.slice(2);
      if (flags.has(flag) || values.has(flag)) throw new TypeError("Identity transition CLI options cannot repeat.");
      flags.add(flag);
      continue;
    }
    const key = argument.slice(2, separator);
    const value = argument.slice(separator + 1);
    if (!key || !value || values.has(key) || flags.has(key)) {
      throw new TypeError("Identity transition CLI options must be unique and non-blank.");
    }
    values.set(key, value);
  }
  return { values, flags };
}

function required(values: Map<string, string>, key: string): string {
  const value = values.get(key);
  if (!value) throw new TypeError(`Identity transition CLI requires --${key}.`);
  values.delete(key);
  return value;
}

function optional(values: Map<string, string>, key: string): string | undefined {
  const value = values.get(key);
  values.delete(key);
  return value;
}

function positiveInteger(values: Map<string, string>, key: string): number {
  const value = Number(required(values, key));
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`Identity transition CLI --${key} must be a positive safe integer.`);
  }
  return value;
}

function optionalPositiveInteger(values: Map<string, string>, key: string): number | undefined {
  const raw = optional(values, key);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`Identity transition CLI --${key} must be a positive safe integer.`);
  }
  return value;
}

function dateValue(value: string, label: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError(`Identity transition CLI --${label} must be an ISO date.`);
  return date;
}

function enumValue<const T extends readonly string[]>(value: string, options: T, label: string): T[number] {
  if (!(options as readonly string[]).includes(value)) {
    throw new TypeError(`Identity transition CLI ${label} is invalid.`);
  }
  return value as T[number];
}

function isCommand(value: string | undefined): value is IdentityTransitionCliOptions["command"] {
  return (
    value === "record-evidence" ||
    value === "request" ||
    value === "attach-evidence" ||
    value === "approve" ||
    value === "apply" ||
    value === "rollback"
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => reportDatabaseCliFailure("Identity transition", error));
}
