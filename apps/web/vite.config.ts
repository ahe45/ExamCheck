import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const templateEditorRuntimeChunks = [
  ["template-editor-runtime-foundation.bundle.js", "template-editor-runtime-foundation"],
  ["template-editor-runtime-objects.bundle.js", "template-editor-runtime-objects"],
  ["template-editor-runtime-bootstrap.bundle.js", "template-editor-runtime-bootstrap"],
] as const;

function getTemplateEditorRuntimeChunk(moduleId: string) {
  const normalizedModuleId = moduleId.replace(/\\/g, "/");
  const runtimeChunk = templateEditorRuntimeChunks.find(([fileName]) =>
    normalizedModuleId.endsWith(`/examlist-template-editor/src/runtime/${fileName}`),
  );

  return runtimeChunk?.[1];
}

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, projectRoot, "");
  const apiPort = Number(environment.PORT || 3100);
  if (!Number.isInteger(apiPort) || apiPort < 1 || apiPort > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }
  const configuredApiUrl = environment.VITE_API_BASE_URL?.trim();
  // Migrate the original .env.example value: localhost in a browser refers to that PC.
  const apiBaseUrl =
    !configuredApiUrl || configuredApiUrl === "http://localhost:3100/api/v1" ? "/api/v1" : configuredApiUrl;

  return {
    envDir: projectRoot,
    define: { "import.meta.env.VITE_API_BASE_URL": JSON.stringify(apiBaseUrl) },
    plugins: [react()],
    build: {
      rollupOptions: {
        output: {
          manualChunks: getTemplateEditorRuntimeChunk,
        },
      },
    },
    optimizeDeps: {
      noDiscovery: true,
      include: ["react", "react-dom/client", "@tanstack/react-query", "zod"],
      exclude: ["examlist-template-editor"],
    },
    server: {
      host: "0.0.0.0",
      port: 5173,
      strictPort: true,
      proxy: {
        "/api": { target: `http://127.0.0.1:${apiPort}`, changeOrigin: true },
      },
    },
  };
});
