import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vitest/config";
import unitConfig from "../vitest.config.js";

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export default mergeConfig(
  unitConfig,
  defineConfig({
    root: apiRoot,
    test: {
      include: ["src/**/*.test.ts", "integration/**/*.integration.ts"],
      fileParallelism: false,
      maxWorkers: 1,
      hookTimeout: 120_000,
      testTimeout: 30_000,
    },
  }),
);
