#!/usr/bin/env node
/** Runtime probes for final 95+ certification — push, tracking, razorpay wiring. */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, ".certification-evidence");
const BASE = process.env.CERT_BASE_URL || "http://localhost:3000";

function loadEnv(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 1) continue;
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

const env = {
  ...loadEnv(join(ROOT, "..", "apps", "backend", ".env")),
  ...loadEnv(join(ROOT, ".env")),
  ...process.env,
};

const results = { generatedAt: new Date().toISOString(), base: BASE, checks: {} };

async function main() {
  mkdirSync(OUT, { recursive: true });

  // Backend health
  try {
    const r = await fetch(`${BASE}/health`);
    const body = await r.json();
    results.checks.backend_health = { ok: r.status === 200, status: r.status, db: body.services?.database };
  } catch (e) {
    results.checks.backend_health = { ok: false, detail: String(e) };
  }

  // Maps tracking API (backend)
  try {
    const login = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "customer@homigo.demo", password: "Homigo@123", setAuthCookies: false }),
    });
    const loginBody = await login.json();
    const token = loginBody.data?.accessToken ?? loginBody.token ?? loginBody.data?.token;
    results.checks.maps_tracking_api = { ok: false, detail: "no token" };
    if (token) {
      const bookings = await fetch(`${BASE}/api/users/bookings?limit=5`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const bBody = await bookings.json();
      const list = bBody.data?.bookings ?? bBody.bookings ?? [];
      const active = list.find((b) => ["accepted", "in_progress", "on_the_way"].includes(String(b.status).toLowerCase()));
      const bookingId = active?.id ?? list[0]?.id;
      if (bookingId) {
        const tr = await fetch(`${BASE}/api/tracking/${bookingId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const trBody = await tr.json();
        results.checks.maps_tracking_api = {
          ok: tr.status === 200,
          status: tr.status,
          bookingId,
          hasLocation: !!(trBody.data?.tracking?.latitude ?? trBody.tracking?.latitude),
        };
      } else {
        results.checks.maps_tracking_api = { ok: false, detail: "no bookings for customer" };
      }
    }
  } catch (e) {
    results.checks.maps_tracking_api = { ok: false, detail: String(e) };
  }

  // Push token registration (authenticated probe)
  try {
    const login = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "customer@homigo.demo", password: "Homigo@123", setAuthCookies: false }),
    });
    const loginBody = await login.json();
    const token = loginBody.data?.accessToken;
    if (!token) {
      results.checks.push_token_registration = { ok: false, detail: `login status=${login.status}` };
    } else {
      const r = await fetch(`${BASE}/api/users/me/devices/push-token`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          deviceId: `cert-probe-${Date.now()}`,
          expoPushToken: "ExponentPushToken[cert-probe]",
          platform: "ANDROID",
        }),
      });
      const body = await r.json();
      results.checks.push_token_registration = {
        ok: r.status === 200 && body.success === true,
        status: r.status,
        deviceId: body.data?.device?.deviceId,
        detail: r.status === 200 ? "PUT /api/users/me/devices/push-token → registered" : JSON.stringify(body).slice(0, 120),
      };
    }
  } catch (e) {
    results.checks.push_token_registration = { ok: false, detail: String(e) };
  }

  // Push endpoint auth gate (unauthenticated)
  try {
    const r = await fetch(`${BASE}/api/users/me/devices/push-token`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: "Bearer invalid" },
      body: JSON.stringify({ deviceId: "probe", expoPushToken: "ExponentPushToken[probe]", platform: "ANDROID" }),
    });
    results.checks.push_token_auth_gate = {
      ok: r.status === 401,
      status: r.status,
      detail: r.status === 401 ? "unauthenticated requests rejected" : await r.text().then((t) => t.slice(0, 120)),
    };
  } catch (e) {
    results.checks.push_token_auth_gate = { ok: false, detail: String(e) };
  }

  // Mobile razorpay wiring (static + env)
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const hasRzp = !!pkg.dependencies?.["react-native-razorpay"];
  const hasKey = !!(env.EXPO_PUBLIC_RAZORPAY_KEY_ID || env.RAZORPAY_KEY_ID);
  const hookExists = existsSync(join(ROOT, "src/hooks/use-razorpay-checkout.ts"));
  results.checks.mobile_razorpay_wiring = {
    ok: hasRzp && hookExists,
    sdk: hasRzp ? pkg.dependencies["react-native-razorpay"] : "missing",
    keyConfigured: hasKey,
    nativeCheckoutRuntime: false,
    detail: "Native Razorpay checkout requires EAS build + physical device — not proven this session",
  };

  // OTA updates config
  const appJson = JSON.parse(readFileSync(join(ROOT, "app.json"), "utf8"));
  const easJson = JSON.parse(readFileSync(join(ROOT, "eas.json"), "utf8"));
  results.checks.ota_updates_config = {
    ok: !!pkg.dependencies?.["expo-updates"] && !!appJson.expo?.runtimeVersion,
    expoUpdates: pkg.dependencies?.["expo-updates"],
    runtimeVersion: appJson.expo?.runtimeVersion,
    updatesUrl: appJson.expo?.updates?.url ?? null,
    channels: Object.fromEntries(
      Object.entries(easJson.build ?? {}).map(([k, v]) => [k, v.channel ?? null]),
    ),
    otaRuntimeProof: false,
    detail: appJson.expo?.updates?.url ? "updates URL set" : "updates URL missing — eas init required",
  };

  writeFileSync(join(OUT, "final-platform-probe.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
