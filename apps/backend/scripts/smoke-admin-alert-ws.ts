/**
 * Smoke: Admin Alert Center realtime push.
 *
 * Proves the full path: admin login → WS auth on /ws/admin-ops → join `admin:ops` room →
 * ops-map dispatcher (`dispatchLiveAlerts`) emits → Redis ws:fanout → server delivers →
 * client receives an `ADMIN_ALERT` frame. No new alert engine; reuses ops-map.service.
 *
 * Run:  bun --env-file=.env run scripts/smoke-admin-alert-ws.ts
 */
import { opsMapService } from "../src/services/ops-map.service";
import { redisClient } from "../src/lib/redis";

const BASE = process.env.SMOKE_BASE ?? "http://localhost:3000";
const WS_BASE = BASE.replace(/^http/i, "ws");

function fail(msg: string): never {
  console.error(`\n❌ FAIL: ${msg}`);
  process.exit(1);
}

async function login(): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "admin@homigo.demo", password: "Homigo@123", setAuthCookies: false }),
  });
  const json = (await res.json()) as { success?: boolean; data?: { accessToken?: string }; accessToken?: string };
  const token = json.data?.accessToken ?? json.accessToken;
  if (!res.ok || !token) fail(`admin login failed (${res.status}): ${JSON.stringify(json).slice(0, 200)}`);
  return token!;
}

async function main() {
  console.log("→ Connecting Redis (for cross-process ws fan-out)…");
  try { await redisClient.connect?.(); } catch { /* may already be connected / disabled */ }

  console.log("→ Logging in as admin@homigo.demo …");
  const token = await login();
  console.log("  ✓ got admin access token");

  const url = `${WS_BASE}/ws/admin-ops?token=${encodeURIComponent(token)}`;
  console.log(`→ Opening WS ${url.replace(/token=[^&]+/, "token=…")}`);

  const received: any[] = [];
  let subscribed = false;

  const ws = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("WS open timeout (4s)")), 4000);
    ws.onopen = () => { clearTimeout(t); resolve(); };
    ws.onerror = (e) => { clearTimeout(t); reject(new Error(`WS error: ${(e as any)?.message ?? "unknown"}`)); };
  }).catch((e) => fail(String(e)));
  console.log("  ✓ WS connected");

  ws.onmessage = (ev) => {
    try {
      const m = JSON.parse(String(ev.data));
      if (m.type === "SUBSCRIBE") { subscribed = true; console.log(`  ✓ joined room: ${m.data?.room ?? "?"}`); }
      if (m.type === "ADMIN_ALERT") { received.push(m.data); console.log(`  ← ADMIN_ALERT ${m.data?.severity}/${m.data?.type} :: ${m.data?.message}`); }
    } catch { /* ignore */ }
  };

  // Give the SUBSCRIBE ack a moment, then run the REAL dispatcher (emits over Redis fan-out).
  await new Promise((r) => setTimeout(r, 600));
  if (!subscribed) fail("did not receive SUBSCRIBE ack (room not joined)");

  console.log("→ Running ops-map dispatcher (dispatchLiveAlerts)…");
  const result = await opsMapService.dispatchLiveAlerts();
  console.log(`  dispatcher: active=${result.active} emitted=${result.emitted} subscribers(local)=${result.subscribers}`);

  // Wait for fan-out delivery.
  await new Promise((r) => setTimeout(r, 1500));

  if (result.active === 0) {
    console.log("\n⚠️  No active ops alerts in the DB right now — plumbing verified (connect+subscribe+dispatch ran), but no ADMIN_ALERT payload to deliver.");
    console.log("    (Create an active booking with a past scheduledDate or an offline assigned provider to generate one.)");
  } else if (received.length === 0) {
    fail(`dispatcher emitted ${result.emitted} alert(s) but the WS client received 0 (fan-out delivery broken)`);
  } else {
    console.log(`\n✅ PASS — WS client received ${received.length} live ADMIN_ALERT frame(s) via /ws/admin-ops.`);
    console.log("   Sample:", JSON.stringify(received[0]).slice(0, 200));
  }

  ws.close();
  process.exit(0);
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
