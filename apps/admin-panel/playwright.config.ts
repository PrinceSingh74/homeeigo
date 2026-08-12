import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const PORT = Number(process.env.E2E_ADMIN_PORT ?? 3003);
const API_URL = (process.env.E2E_API_URL ?? "http://localhost:3000").replace(/\/$/, "");
const BASE_URL = (process.env.E2E_ADMIN_URL ?? `http://localhost:${PORT}`).replace(/\/$/, "");

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.E2E_SKIP_SERVERS
    ? undefined
    : [
        {
          command: "bun --env-file=.env run src/index.ts",
          cwd: path.join(__dirname, "../backend"),
          url: `${API_URL}/health`,
          reuseExistingServer: !process.env.CI,
          timeout: 180_000,
        },
        {
          command: "npm run dev",
          cwd: __dirname,
          url: BASE_URL,
          reuseExistingServer: !process.env.CI,
          timeout: 180_000,
          env: {
            ...process.env,
            NEXT_PUBLIC_API_URL: API_URL,
          },
        },
      ],
});
