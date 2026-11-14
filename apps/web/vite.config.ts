import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Relative base + hash routing: works from any static host, no server rewrites.
export default defineConfig({
  base: "./",
  plugins: [react()],
  server: { host: true, fs: { allow: ["../.."] } },
  build: { chunkSizeWarningLimit: 2000 },
});
