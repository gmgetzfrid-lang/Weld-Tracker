import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri serves the built assets from the filesystem, so use relative paths.
export default defineConfig({
  plugins: [react()],
  base: "./",
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    target: "es2021",
    sourcemap: false,
  },
});
