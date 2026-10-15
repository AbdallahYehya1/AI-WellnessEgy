import { defineConfig, devices } from "@playwright/test";

// End-to-end tests run against a locally started app (see e2e/README.md):
// the Compose API + mock auth (e2e/compose.e2e.yml) and the Next.js server
// at E2E_BASE_URL. They are not part of CI yet. System Edge is used so no
// browser download is needed; set PLAYWRIGHT_CHANNEL to change it.
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3100",
    channel: process.env.PLAYWRIGHT_CHANNEL ?? "msedge",
    trace: "off",
    screenshot: "off",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Edge"], channel: process.env.PLAYWRIGHT_CHANNEL ?? "msedge" } },
  ],
});
