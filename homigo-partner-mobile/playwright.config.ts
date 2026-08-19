import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const API_URL = (process.env.E2E_API_URL ?? "http://localhost:3000").replace(/\/$/, "");
const EXPO_PORT = Number(process.env.E2E_EXPO_PORT ?? 8081);
const BASE_URL = (process.env.E2E_EXPO_URL ?? `http://localhost:${EXPO_PORT}`).replace(/\/$/, "");

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: 0,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 90_000 },
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    navigationTimeout: 120_000,
    ...devices["Pixel 7"],
  },
  projects: [{ name: "chromium", use: { ...devices["Pixel 7"] } }],
  webServer: process.env.E2E_SKIP_SERVERS
    ? undefined
    : [
        {
          command: "bun run dev",
          cwd: path.join(__dirname, "../apps/backend"),
          url: `${API_URL}/health`,
          reuseExistingServer: !process.env.CI,
          timeout: 180_000,
        },
        {
          command: process.env.E2E_SERVE_EXISTING
            ? "npx --yes serve dist-e2e -l 8081 --single --no-port-switching"
            : "npx expo export --platform web --output-dir dist-e2e && node scripts/patch-expo-web-html.js && npx --yes serve dist-e2e -l 8081 --single --no-port-switching",
          cwd: __dirname,
          url: BASE_URL,
          reuseExistingServer: false,
          timeout: 240_000,
          env: {
            ...process.env,
            CI: "1",
            EXPO_NO_TELEMETRY: "1",
            EXPO_PUBLIC_API_URL: API_URL,
          },
        },
      ],
});
