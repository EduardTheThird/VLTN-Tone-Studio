import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { pdfjsAssets } from "./scripts/pdfjs-assets";

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()], resolve: { alias: { "@shared": resolve("src/shared") } } },
  // Both preloads are CommonJS: the audience window is sandboxed, and a sandboxed preload cannot be an ES module.
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { "@shared": resolve("src/shared") } },
    build: {
      rollupOptions: {
        input: { index: resolve("src/preload/index.ts"), "audience-window": resolve("src/preload/audience-window.ts") },
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },
  renderer: {
    resolve: { alias: { "@": resolve("src/renderer/src"), "@shared": resolve("src/shared") } },
    plugins: [react(), tailwindcss(), pdfjsAssets()],
    worker: { format: 'es' },
    // onnxruntime-web (Song stem splitter worker) ships a ready ESM bundle; pre-bundling it on first use reloads the page.
    optimizeDeps: { exclude: ["onnxruntime-web", "@huggingface/transformers"] },
  },
});
