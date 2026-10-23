import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";
import { fileURLToPath } from "node:url";

/** Build de demonstração: um único HTML; React, Leaflet e SheetJS vêm da CDN como globais. */
export default defineConfig({
  plugins: [react({ jsxRuntime: "automatic" }), viteSingleFile({ removeViteModuleLoader: true })],
  resolve: { alias: [{ find: /^react\/jsx(-dev)?-runtime$/, replacement: fileURLToPath(new URL("./src/jsx-shim.ts", import.meta.url)) }] },
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    target: "es2020", cssCodeSplit: false, assetsInlineLimit: 100000000, outDir: "dist",
    rollupOptions: {
      external: ["react", "react-dom", "react-dom/client", "leaflet", "xlsx"],
      output: { format: "iife", globals: { react: "React", "react-dom": "ReactDOM", "react-dom/client": "ReactDOM", leaflet: "L", xlsx: "XLSX" }, inlineDynamicImports: true },
    },
  },
});
