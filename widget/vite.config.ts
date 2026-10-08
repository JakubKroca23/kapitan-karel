import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, "src/main.ts"),
      name: "KapitanKarelChat",
      formats: ["iife"],
      fileName: () => "widget.js",
    },
    outDir: "dist",
    emptyOutDir: true,
    cssCodeSplit: false,
  },
});
