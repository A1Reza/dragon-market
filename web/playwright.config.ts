import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  timeout: 180000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ["list"],
    ["html", { open: "never" }],
    ["json", { outputFile: "../artifacts/playwright-results.json" }],
  ],
  use: {
    baseURL: "http://127.0.0.1:5175",
    actionTimeout: 10000,
    navigationTimeout: 15000,
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
      },
    },
  ],
  webServer: {
    command: "node ../scripts/e2e-stack.mjs",
    url: "http://127.0.0.1:5175/api/dev/snapshot",
    reuseExistingServer: false,
    timeout: 180000,
  },
  globalTeardown: "../scripts/e2e-cleanup.mjs",
});
