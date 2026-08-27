import "reflect-metadata";
import dotenv from "dotenv";
import { NestFactory } from "@nestjs/core";
import { resolve } from "node:path";
import { AppModule } from "./app.module.js";
import { API_GLOBAL_PREFIX, configureApplication } from "./application-config.js";
import { resolveAppConfig } from "./config/app-config.js";

async function bootstrap() {
  dotenv.config({ path: resolve(process.cwd(), "../../.env"), quiet: true });
  dotenv.config({ path: resolve(process.cwd(), ".env"), quiet: true });
  const config = resolveAppConfig(process.env);
  const app = await NestFactory.create(AppModule.forRoot(config));

  configureApplication(app, { frontendOrigins: config.http.frontendOrigins });
  app.enableShutdownHooks();

  await app.listen(config.http.port);
  console.log(`가번호 관리 시스템 API is running at http://localhost:${config.http.port}/${API_GLOBAL_PREFIX}`);
}

bootstrap().catch((error: unknown) => {
  console.error("가번호 관리 시스템 API failed to start", error);
  process.exitCode = 1;
});
