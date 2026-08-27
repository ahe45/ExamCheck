import { defineConfig } from "vitest/config";
import ts from "typescript";
import type { Plugin } from "vite";

export default defineConfig({
  plugins: [emitNestDecoratorMetadata()],
  test: {
    environment: "node",
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "../../coverage/api",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.module.ts",
        "src/**/*.dto.ts",
        "src/database/migrations/**",
        "src/main.ts",
        "src/database/{bootstrap,migrate,setup}.ts",
      ],
      thresholds: {
        // Source-map-aware full-source baseline measured on 2026-08-28:
        // 85.01 lines/statements, 81.98 branches, and 86.14 functions.
        lines: 84.9,
        statements: 84.9,
        branches: 81.9,
        functions: 86,
        "src/uniqueness/**": {
          lines: 100,
          statements: 100,
          branches: 100,
          functions: 100,
        },
        "src/config/**": {
          lines: 95,
          statements: 95,
          branches: 95,
          functions: 95,
        },
      },
    },
  },
});

function emitNestDecoratorMetadata(): Plugin {
  return {
    name: "emit-nest-decorator-metadata",
    enforce: "pre",
    transform(source, id) {
      const fileName = id.split("?", 1)[0];
      if (!fileName.endsWith(".ts") || fileName.includes("/node_modules/")) return null;

      const result = ts.transpileModule(source, {
        fileName,
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          sourceMap: true,
          inlineSources: true,
        },
      });
      return {
        code: result.outputText,
        map: result.sourceMapText ? JSON.parse(result.sourceMapText) : null,
      };
    },
  };
}
