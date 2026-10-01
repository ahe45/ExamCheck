// Used only by smoke-test.ps1 against its isolated settings file.
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
const [stage, data, action] = process.argv.slice(2);
const { default: mysql } = await import(pathToFileURL(join(stage, "node_modules/mysql2/promise.js")).href);
const settings = JSON.parse(await readFile(join(data, "settings.json"), "utf8"));
const connection = await mysql.createConnection({
  host: "127.0.0.1",
  port: settings.dbPort,
  user: "root",
  password: settings.dbPassword,
  database: "examcheck",
});
try {
  if (action === "seed") await connection.execute("UPDATE app_user SET session_version = 701 WHERE login_id = 'admin'");
  else if (action === "change")
    await connection.execute("UPDATE app_user SET session_version = 702 WHERE login_id = 'admin'");
  else {
    const [rows] = await connection.execute("SELECT session_version FROM app_user WHERE login_id = 'admin'");
    if (Number(rows[0]?.session_version) !== 701) throw new Error("Restored content does not match the backup.");
    console.log("Backup contents restored correctly.");
  }
} finally {
  await connection.end();
}
