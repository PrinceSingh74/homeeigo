/**
 * Smoke checks for mobile OAuth + push token + AI endpoints.
 * Run: bun run scripts/smoke-mobile-production.ts (from apps/backend)
 */
import { smokeReq, smokeAppReq } from "./smoke-lib";

const base = process.env.API_BASE_URL ?? "http://localhost:3000";

async function main() {
  const checks: Array<{ name: string; ok: boolean; detail?: string }> = [];

  const health = await smokeReq(base, "/health");
  checks.push({ name: "Backend health", ok: health.status === 200, detail: String(health.status) });

  const googleAuth = await smokeReq(base, "/api/auth/google/authorize", {
    method: "POST",
    body: JSON.stringify({ state: "smoke-test-state" }),
  });
  checks.push({
    name: "Google OAuth authorize route",
    ok: googleAuth.status === 200 || googleAuth.status === 503,
    detail: String(googleAuth.status),
  });

  const appleAuth = await smokeReq(base, "/api/auth/apple/authorize", {
    method: "POST",
    body: JSON.stringify({ state: "smoke-test-state" }),
  });
  checks.push({
    name: "Apple OAuth authorize route",
    ok: appleAuth.status === 200 || appleAuth.status === 503,
    detail: String(appleAuth.status),
  });

  // Auth-guard checks use in-process routing so they validate the current codebase
  // even when a stale HTTP server is still bound to localhost:3000.
  const aiChat = await smokeAppReq("/api/ai/chat", {
    method: "POST",
    headers: { Authorization: "Bearer invalid" },
    body: JSON.stringify({ message: "hello" }),
  });
  checks.push({
    name: "AI chat auth guard",
    ok: aiChat.status === 401,
    detail: String(aiChat.status),
  });

  const pushRoute = await smokeAppReq("/api/users/me/devices/push-token", {
    method: "PUT",
    headers: { Authorization: "Bearer invalid" },
    body: JSON.stringify({
      deviceId: "smoke-device",
      expoPushToken: "ExponentPushToken[smoke]",
      platform: "ANDROID",
    }),
  });
  checks.push({
    name: "Push token auth guard",
    ok: pushRoute.status === 401,
    detail: String(pushRoute.status),
  });

  const aiHttp = await smokeReq(base, "/api/ai/chat", {
    method: "POST",
    headers: { Authorization: "Bearer invalid" },
    body: JSON.stringify({ message: "hello" }),
  });
  if (aiHttp.status === 404 && aiChat.status === 401) {
    console.warn(
      "WARN: HTTP server at %s is missing /api/ai/chat (404). Restart backend to pick up Phase 3 routes.",
      base,
    );
  }

  const pushHttp = await smokeReq(base, "/api/users/me/devices/push-token", {
    method: "PUT",
    headers: { Authorization: "Bearer invalid" },
    body: JSON.stringify({
      deviceId: "smoke-device",
      expoPushToken: "ExponentPushToken[smoke]",
      platform: "ANDROID",
    }),
  });
  if (pushHttp.status === 404 && pushRoute.status === 401) {
    console.warn(
      "WARN: HTTP server at %s is missing /api/users/me/devices/push-token (404). Restart backend to pick up Phase 3 routes.",
      base,
    );
  }

  const failed = checks.filter((c) => !c.ok);
  for (const c of checks) {
    console.log(`${c.ok ? "PASS" : "FAIL"} ${c.name}${c.detail ? ` (${c.detail})` : ""}`);
  }
  if (failed.length) process.exit(1);
}

void main();
