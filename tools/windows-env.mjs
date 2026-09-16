import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const configurableKeys = ["DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD"];
const defaults = { DB_HOST: "127.0.0.1", DB_PORT: "3306", DB_NAME: "examcheck", DB_USER: "root", DB_PASSWORD: "" };

function encodeValue(key, value) {
  // Validate using the same parser as the API, including #, quotes and literal backslashes.
  for (const candidate of [value, `'${value}'`, `"${value}"`, "`" + value + "`"]) {
    const parsed = dotenv.parse(`${key}=${candidate}\n`);
    if (Object.keys(parsed).length === 1 && parsed[key] === value) return candidate;
  }
  throw new Error(`Cannot safely write ${key}; .env was not changed.`);
}

export function updateEnvironment(source, updates) {
  if (!updates || typeof updates !== "object" || Array.isArray(updates)) throw new Error("Invalid setup settings.");
  for (const [key, value] of Object.entries(updates)) {
    if (!configurableKeys.includes(key) || typeof value !== "string" || /[\r\n]/.test(value)) {
      throw new Error("Invalid database setting; .env was not changed.");
    }
  }
  const pending = new Map(Object.entries(updates));
  // Match complete dotenv assignments so multiline unrelated values and comments survive.
  const assignments =
    /(?:^|^)\s*(?:export\s+)?([\w.-]+)(?:\s*=\s*?|:\s+?)(\s*'(?:\\'|[^'])*'|\s*"(?:\\"|[^"])*"|\s*`(?:\\`|[^`])*`|[^#\r\n]+)?\s*(?:#.*)?(?:$|$)/gm;
  let result = source.replace(assignments, (assignment, key) => {
    if (!Object.hasOwn(updates, key)) return assignment;
    pending.delete(key);
    const leadingLines = assignment.match(/^\s*\n/)?.[0] || "";
    return `${leadingLines}${key}=${encodeValue(key, updates[key])}`;
  });
  for (const [key, value] of pending) result += `\n${key}=${encodeValue(key, value)}`;
  const parsed = dotenv.parse(result);
  for (const [key, value] of Object.entries(updates)) {
    if (parsed[key] !== value) throw new Error(`Could not verify ${key}; .env was not changed.`);
  }
  return result.replace(/\r?\n/g, "\r\n").replace(/(?:\r\n)*$/, "\r\n");
}

export function needsDatabaseSetup(source) {
  const settings = dotenv.parse(source);
  return configurableKeys.some((key) => !settings[key]?.trim()) || settings.DB_PASSWORD === "change-this-db-password";
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const envPath = resolve(root, ".env");
  const exists = existsSync(envPath);
  const source = readFileSync(exists ? envPath : resolve(root, ".env.example"), "utf8");
  if (process.argv[2] === "check") {
    process.exitCode = !exists || needsDatabaseSetup(source) ? 2 : 0;
  } else if (process.argv[2] === "read") {
    const settings = dotenv.parse(source);
    const values = Object.fromEntries(configurableKeys.map((key) => [key, settings[key] || defaults[key]]));
    if (values.DB_PASSWORD === "change-this-db-password") values.DB_PASSWORD = "";
    // Native stdout may be decoded using a legacy code page by Windows PowerShell 5.1.
    process.stdout.write(
      JSON.stringify(values).replace(
        /[^\x00-\x7f]/g,
        (character) => "\\u" + character.charCodeAt(0).toString(16).padStart(4, "0"),
      ),
    );
  } else if (process.argv[2] === "write") {
    let updates;
    try {
      updates = JSON.parse(Buffer.from(readFileSync(0, "utf8").trim(), "base64").toString("utf8"));
    } catch {
      throw new Error("Could not read setup settings; .env was not changed.");
    }
    const result = updateEnvironment(source, updates);
    const settings = dotenv.parse(result);
    if (needsDatabaseSetup(result)) throw new Error("Complete all database settings; .env was not changed.");
    if (!/^[a-zA-Z0-9_]+$/.test(settings.DB_NAME))
      throw new Error("DB_NAME may contain only letters, numbers and underscores.");
    const port = Number(settings.DB_PORT);
    if (!Number.isSafeInteger(port) || port < 1 || port > 65535)
      throw new Error("DB_PORT must be between 1 and 65535.");
    writeFileSync(envPath, result, "utf8");
    console.log("Database settings saved to .env.");
  } else {
    throw new Error("Expected check, read or write.");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
