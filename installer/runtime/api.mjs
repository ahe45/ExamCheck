import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../apps/api/dist/app.module.js";
import { configureApplication } from "../apps/api/dist/application-config.js";
import { resolveAppConfig } from "../apps/api/dist/config/app-config.js";

const config = resolveAppConfig(process.env);
const app = await NestFactory.create(AppModule.forRoot(config));
configureApplication(app, { frontendOrigins: config.http.frontendOrigins });
// Only the web port is shared with other PCs; API and database stay on loopback.
await app.listen(config.http.port, "127.0.0.1");
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await app.close();
  process.exit(0);
}
process.on("message", (message) => {
  if (message === "stop") void stop();
});
process.on("disconnect", () => void stop());
process.on("SIGTERM", () => void stop());
