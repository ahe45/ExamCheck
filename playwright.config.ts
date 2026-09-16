import { defineConfig } from "@playwright/test";

const webPort = Number(process.env.E2E_WEB_PORT);
const apiPort = Number(process.env.E2E_API_PORT);
if (!Number.isInteger(webPort) || !Number.isInteger(apiPort)) {
  throw new Error("Playwright requires isolated API and Web ports from the E2E runner.");
}
const baseURL = `http://127.0.0.1:${webPort}`;
const apiURL = `http://127.0.0.1:${apiPort}`;
const e2eDatabaseName = process.env.E2E_DB_NAME;
const serversManagedByRunner = process.env.E2E_MANAGED_SERVERS === "1";

if (!e2eDatabaseName || !/^examcheck_e2e_[0-9a-f]{32}$/.test(e2eDatabaseName)) {
  throw new Error("Playwright must be started through npm run test:e2e so it uses an isolated E2E database.");
}

export default defineConfig({
  testDir: "./e2e",
  outputDir: "test-results/playwright",
  snapshotPathTemplate: "{testDir}/visual-baselines/{platform}/{projectName}/{arg}{ext}",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  updateSnapshots: "none",
  reporter: [["list"], ["html", { outputFolder: "test-results/playwright-report", open: "never" }]],
  use: {
    baseURL,
    headless: true,
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    colorScheme: "light",
    reducedMotion: "reduce",
    deviceScaleFactor: 1,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "off",
  },
  webServer: serversManagedByRunner
    ? undefined
    : [
        {
          command: "node ../../node_modules/tsx/dist/cli.mjs src/main.ts",
          cwd: "apps/api",
          url: `${apiURL}/api/v1/health`,
          reuseExistingServer: false,
          timeout: 120_000,
          env: { PORT: String(apiPort), FRONTEND_ORIGIN: baseURL, DB_NAME: e2eDatabaseName },
        },
        {
          command: `node ../../node_modules/vite/bin/vite.js --configLoader runner --host 127.0.0.1 --port ${webPort} --strictPort`,
          cwd: "apps/web",
          url: baseURL,
          reuseExistingServer: false,
          timeout: 120_000,
          env: { VITE_API_BASE_URL: `${apiURL}/api/v1` },
        },
      ],
  projects: [
    {
      name: "hd",
      testMatch: /role-smoke\.spec\.ts/,
      use: { viewport: { width: 1366, height: 768 } },
    },
    {
      name: "hd-plus",
      testMatch: /role-smoke\.spec\.ts/,
      use: { viewport: { width: 1600, height: 900 } },
    },
    {
      name: "fhd",
      testMatch: /role-smoke\.spec\.ts/,
      use: { viewport: { width: 1920, height: 1080 } },
    },
    {
      name: "qhd",
      testMatch: /role-smoke\.spec\.ts/,
      use: { viewport: { width: 2560, height: 1440 } },
    },
    {
      name: "visual-fhd",
      testMatch: /visual\.spec\.ts/,
      retries: 0,
      use: { viewport: { width: 1920, height: 1080 } },
    },
    {
      name: "visual-qhd",
      testMatch: /visual\.spec\.ts/,
      retries: 0,
      use: { viewport: { width: 2560, height: 1440 } },
    },
    {
      name: "workflow-fhd",
      testMatch: /workflow\.spec\.ts/,
      use: { viewport: { width: 1920, height: 1080 } },
    },
    {
      name: "template-editor-fhd",
      testMatch:
        /template-(editor|clipboard|operation-pdf|navigation|empty-document|font-height|distribution|date-format)\.spec\.ts/,
      use: { viewport: { width: 1920, height: 1080 } },
    },
  ],
});
