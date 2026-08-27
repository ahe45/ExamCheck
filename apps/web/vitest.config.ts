import { defineConfig } from "vitest/config";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(webRoot, "../..");
const testingRuntime = (entry: string) => resolve(workspaceRoot, "node_modules", entry);

export default defineConfig({
  resolve: {
    // Testing Library and its renderer are installed at the workspace root.
    // Resolve component imports through that same copy to avoid two dispatchers.
    alias: [
      { find: "react/jsx-dev-runtime", replacement: testingRuntime("react/jsx-dev-runtime.js") },
      { find: "react/jsx-runtime", replacement: testingRuntime("react/jsx-runtime.js") },
      { find: "react-dom/test-utils", replacement: testingRuntime("react-dom/test-utils.js") },
      { find: "react-dom/client", replacement: testingRuntime("react-dom/client.js") },
      { find: "react-dom/server", replacement: testingRuntime("react-dom/server.js") },
      { find: "react-dom", replacement: testingRuntime("react-dom/index.js") },
      { find: "react", replacement: testingRuntime("react/index.js") },
    ],
  },
  test: {
    environment: "node",
    setupFiles: ["./src/test/setup.ts"],
    clearMocks: true,
    restoreMocks: true,
    server: {
      deps: {
        inline: ["@tanstack/react-query", "@testing-library/react", "react", "react-dom"],
      },
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "../../coverage/web",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/main.tsx", "src/vite-env.d.ts"],
      thresholds: {
        // Full-source baseline measured on 2026-08-28: 60.44 lines/statements,
        // 75.99 branches, and 60.56 functions.
        lines: 60.3,
        statements: 60.3,
        branches: 75.8,
        functions: 60.4,
        "src/features/developer/DeveloperSettingsPage.tsx": {
          lines: 82,
          statements: 82,
          branches: 72,
          functions: 40,
        },
        "src/shared/navigation/**": {
          lines: 95,
          statements: 95,
          branches: 95,
          functions: 95,
        },
      },
    },
  },
});
