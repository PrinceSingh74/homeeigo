import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3001);
const API_URL = (process.env.E2E_API_URL ?? "http://localhost:3000").replace(/\/$/, "");
const WEB_URL = (process.env.E2E_WEB_URL ?? `http://localhost:${WEB_PORT}`).replace(
  /\/$/,
  "",
);
const E2E_PRODUCTION = process.env.E2E_PRODUCTION === "1" || process.env.CI === "true";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: WEB_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } },
    },
  ],
  webServer: process.env.E2E_SKIP_SERVERS
    ? undefined
    : [
        {
          command: "bun run dev",
          cwd: path.join(__dirname, "../backend"),
          url: `${API_URL}/health`,
          reuseExistingServer: !process.env.CI,
          timeout: 180_000,
        },
        {
          command: E2E_PRODUCTION
            ? `npm run build && npx next start -p ${WEB_PORT}`
            : "npm run dev",
          cwd: __dirname,
          url: WEB_URL,
          reuseExistingServer: !process.env.CI,
          timeout: E2E_PRODUCTION ? 300_000 : 180_000,
          env: {
            ...process.env,
            NEXT_PUBLIC_API_URL: API_URL,
            NODE_ENV: E2E_PRODUCTION ? "production" : "development",
          },
        },
      ],
});
