import { defineConfig, devices } from "@playwright/test";

// The built app is served statically, as GitHub Pages would serve it, under the same base path.
export default defineConfig({
  testDir: "./e2e",
  timeout: 120000,
  retries: 0,
  use: { baseURL: "http://localhost:4173/c-game/", ...devices["Desktop Chrome"], viewport: { width: 1400, height: 900 }, colorScheme: "dark" },
  webServer: { command: "pnpm exec vite preview --port 4173 --strictPort", port: 4173, reuseExistingServer: true, timeout: 60000 },
  projects: [
    { name: "smoke", testMatch: /smoke\.spec\.ts/ },
    { name: "screenshots", testMatch: /screenshots\.spec\.ts/ },
  ],
});
