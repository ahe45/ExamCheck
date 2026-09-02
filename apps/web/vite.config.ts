import { defineConfig } from "vite";
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

export default defineConfig({
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
  server: { port: 5173 },
});
