import { loadDatabaseCliConfig, reportDatabaseCliFailure, withDatabaseConnection } from "./database-cli-runtime.js";
import { IdentityBackfillService } from "./identity-backfill.js";
import { pathToFileURL } from "node:url";

interface CliOptions {
  confirmIsolatedCopy: boolean;
  examName: string;
  chunkSize?: number;
  runId?: string;
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2), process.env.DEFAULT_EXAM_NAME ?? "");
  const config = loadDatabaseCliConfig();
  assertIsolatedExecution(config.database, options.confirmIsolatedCopy);
  const report = await withDatabaseConnection(config, { createDatabase: false }, (connection) =>
    new IdentityBackfillService().run(connection, {
      confirmIsolatedCopy: options.confirmIsolatedCopy,
      examName: options.examName,
      ...(options.chunkSize === undefined ? {} : { chunkSize: options.chunkSize }),
      ...(options.runId === undefined ? {} : { runId: options.runId }),
    }),
  );
  console.log(JSON.stringify(report, null, 2));
  if (report.status !== "SUCCEEDED") process.exitCode = 2;
}

export function parseCliOptions(arguments_: readonly string[], defaultExamName: string): CliOptions {
  let confirmIsolatedCopy = false;
  let examName = defaultExamName.normalize("NFKC").trim();
  let chunkSize: number | undefined;
  let runId: string | undefined;
  for (const argument of arguments_) {
    if (argument === "--confirm-isolated-copy") {
      confirmIsolatedCopy = true;
      continue;
    }
    if (argument.startsWith("--exam-name=")) {
      examName = argument.slice("--exam-name=".length).normalize("NFKC").trim();
      continue;
    }
    if (argument.startsWith("--chunk-size=")) {
      chunkSize = Number(argument.slice("--chunk-size=".length));
      continue;
    }
    if (argument.startsWith("--resume=")) {
      runId = argument.slice("--resume=".length).trim();
      continue;
    }
    throw new TypeError(`Unknown identity backfill option: ${argument}`);
  }
  if (!examName) throw new TypeError("Use --exam-name=<name> or configure DEFAULT_EXAM_NAME.");
  return {
    confirmIsolatedCopy,
    examName,
    ...(chunkSize === undefined ? {} : { chunkSize }),
    ...(runId === undefined ? {} : { runId }),
  };
}

export function assertIsolatedExecution(databaseName: string, confirmed: boolean): void {
  if (!confirmed) {
    throw new Error("Identity backfill is blocked until --confirm-isolated-copy is provided.");
  }
  if (!/(?:^|[_-])(it|test|shadow|sandbox|staging|refactor)(?:[_-]|$)/i.test(databaseName)) {
    throw new Error(
      "Identity backfill CLI only accepts an explicitly named isolated database copy. " +
        "Operational execution requires the separately approved cutover procedure.",
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => reportDatabaseCliFailure("Identity backfill", error));
}
