import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "src-admin",
  plugins: [
    react(),
    {
      name: "inject-iobroker-admin-scripts",
      transformIndexHtml() {
        return [
          {
            tag: "script",
            attrs: { src: "../../lib/js/jquery-3.2.1.min.js" },
            injectTo: "head",
          },
          {
            tag: "script",
            attrs: { src: "../../socket.io/socket.io.js" },
            injectTo: "head",
          },
          {
            tag: "script",
            attrs: { src: "../../js/adapter-settings.js" },
            injectTo: "head",
          },
        ];
      },
    },
  ],
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
