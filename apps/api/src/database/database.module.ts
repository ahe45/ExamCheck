import { instrumentDatabasePool } from "../common/database/database-metrics.js";
import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from "@nestjs/common";
import mysql, { type Pool } from "mysql2/promise";
import { APP_CONFIG, type AppConfig } from "../config/app-config.js";
import { DATABASE_POOL } from "./database.constants.js";

@Injectable()
export class DatabasePoolLifecycle implements OnApplicationShutdown {
  private closing: Promise<void> | null = null;

  constructor(@Inject(DATABASE_POOL) private readonly pool: Pick<Pool, "end">) {}

  onApplicationShutdown(): Promise<void> {
    this.closing ??= this.pool.end();
    return this.closing;
  }
}

@Global()
@Module({
  providers: [
    {
      provide: DATABASE_POOL,
      inject: [APP_CONFIG],
      useFactory: (config: Readonly<AppConfig>): Pool => {
        return instrumentDatabasePool(
          mysql.createPool({
            ...config.database,
            waitForConnections: true,
          }),
        );
      },
    },
    DatabasePoolLifecycle,
  ],
  exports: [DATABASE_POOL],
})
export class DatabaseModule {}
