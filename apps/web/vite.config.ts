import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const STATIC = process.env.VITE_STATIC === "1";

/**
 * The static build ("Try it" page, no server): the 5 MB per-match file of the recorded roster is only a fallback for
 * a missing report, so it is left out; and the art of the games the page cannot play (cards, tentacle run) is not
 * copied, which keeps the folder small.
 */
function staticTrim(outDir: string): Plugin {
  return {
    name: "static-trim",
    enforce: "pre",
    resolveId(id) {
      return id.endsWith("recorded-roster-match-results.json") ? "\0static-empty" : null;
    },
    load(id) {
      return id === "\0static-empty" ? "export default [];" : null;
    },
    closeBundle() {
      for (const dir of ["hero_cards", "sepia_tentacle_run"]) {
        rmSync(resolve(outDir, "assets", dir), { recursive: true, force: true });
      }
    },
  };
}

// Relative base + hash routing: works from any static host, no server rewrites.
export default defineConfig({
  base: "./",
  plugins: [react(), ...(STATIC ? [staticTrim(resolve(__dirname, "dist-static"))] : [])],
  server: { host: true, fs: { allow: ["../.."] } },
  build: { chunkSizeWarningLimit: 2000, ...(STATIC ? { outDir: "dist-static", emptyOutDir: true } : {}) },
});
