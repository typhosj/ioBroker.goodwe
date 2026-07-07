import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "src-admin",
  plugins: [react()],
  base: "./",
  build: {
    outDir: "../admin",
    emptyOutDir: false,
    assetsDir: "assets",
    rollupOptions: {
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
});
