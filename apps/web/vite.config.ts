/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Served from GitHub Pages under /<repo>/; a hash router keeps every route reachable from the one index.html.
export default defineConfig({
  plugins: [react()],
  base: process.env.DESK_BASE ?? "/c-game/",
  build: { outDir: "dist", sourcemap: false, chunkSizeWarningLimit: 1500 },
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.tsx", "test/**/*.test.ts"],
    setupFiles: ["./test/setup.ts"],
    exclude: ["e2e/**", "node_modules/**"],
  },
});
