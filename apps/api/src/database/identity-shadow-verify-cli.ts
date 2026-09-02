import { pathToFileURL } from "node:url";
import {
  IdentityShadowVerifier,
  assertIsolatedShadowExecution,
} from "../identity-transition/identity-shadow-verifier.js";
import { loadDatabaseCliConfig, reportDatabaseCliFailure, withDatabaseConnection } from "./database-cli-runtime.js";

export interface IdentityShadowVerifyCliOptions {
  confirmIsolatedCopy: boolean;
}

async function main(): Promise<void> {
  const options = parseIdentityShadowVerifyCliOptions(process.argv.slice(2));
  const config = loadDatabaseCliConfig();
  // Refuse before opening a database connection as well as inside the verifier.
  assertIsolatedShadowExecution(config.database, options.confirmIsolatedCopy);
  const hmacSecret = process.env.IDENTITY_SHADOW_HMAC_SECRET ?? "";
  const report = await withDatabaseConnection(config, { createDatabase: false }, (connection) =>
    new IdentityShadowVerifier().run(connection, {
      confirmIsolatedCopy: options.confirmIsolatedCopy,
      hmacSecret,
    }),
  );
  console.log(JSON.stringify(report, null, 2));
  if (report.status !== "MATCH") process.exitCode = 2;
}

export function parseIdentityShadowVerifyCliOptions(arguments_: readonly string[]): IdentityShadowVerifyCliOptions {
  let confirmIsolatedCopy = false;
  for (const argument of arguments_) {
    if (argument === "--confirm-isolated-copy") {
      confirmIsolatedCopy = true;
      continue;
    }
    throw new TypeError(`Unknown identity shadow verification option: ${argument}`);
  }
  return { confirmIsolatedCopy };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => reportDatabaseCliFailure("Identity shadow verification", error));
}
