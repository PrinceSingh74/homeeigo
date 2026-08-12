/**
 * Smoke: prove the `checkout` + `geofence` feature metrics increment LIVE in the server's
 * /metrics by driving the REAL HTTP routes (so the counters land in the server process).
 *
 *  - checkout: POST /api/wallet/checkout/pay  → recordFeatureEvent("checkout","wallet_paid")
 *  - geofence: POST /api/geo/checkin (outside→inside) → recordFeatureEvent("geofence","enter")
 *
 * Reuses existing routes/services — no new endpoints. Run:
 *   bun --env-file=.env run scripts/smoke-feature-metrics.ts
 */
import prisma from "../src/lib/prisma";
import { geofenceService } from "../src/services/geofence.service";

const BASE = process.env.SMOKE_BASE ?? "http://localhost:3000";

async function login(email: string, password: string): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, setAuthCookies: false }),
  });
  const j = (await res.json()) as any;
  const token = j?.data?.accessToken ?? j?.accessToken;
  if (!token) throw new Error(`login failed (${res.status}): ${JSON.stringify(j).slice(0, 160)}`);
  return token;
}

async function metricLine(substr: string): Promise<string[]> {
  const txt = await (await fetch(`${BASE}/metrics`)).text();
  return txt.split("\n").filter((l) => l.includes(substr));
}

async function main() {
  const token = await login("customer@homigo.demo", "Homigo@123");
  const auth = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  console.log("✓ customer logged in");

  // ---------- CHECKOUT ----------
  const booking = await prisma.booking.findFirst({
    where: { user: { email: "customer@homigo.demo" }, paymentStatus: { not: "SUCCESS" }, finalAmount: { gt: 0 } },
    orderBy: { createdAt: "desc" }, select: { id: true, finalAmount: true, bookingNumber: true },
  });
  if (!booking) throw new Error("no unpaid booking to pay");
  console.log(`→ paying booking ${booking.bookingNumber} (₹${booking.finalAmount}) from wallet…`);
  const payRes = await fetch(`${BASE}/api/wallet/checkout/pay`, { method: "POST", headers: auth, body: JSON.stringify({ bookingId: booking.id }) });
  const payJson = (await payRes.json()) as any;
  console.log(`  checkout/pay → HTTP ${payRes.status}:`, JSON.stringify(payJson).slice(0, 160));

  // ---------- GEOFENCE ----------
  let gf = await prisma.geofence.findFirst({ where: { isActive: true }, select: { id: true, centerLat: true, centerLng: true } });
  if (!gf) {
    const created = await geofenceService.create({ name: "Smoke Zone — Bangalore", zoneType: "SERVICE", city: "Bengaluru", state: "Karnataka", centerLat: 12.9716, centerLng: 77.5946, radiusMeters: 8000 });
    gf = { id: created.id, centerLat: 12.9716, centerLng: 77.5946 };
    console.log("✓ created active geofence for the test");
  }
  // outside first (Mumbai), then inside (zone centre) → fires ENTER
  await fetch(`${BASE}/api/geo/checkin`, { method: "POST", headers: auth, body: JSON.stringify({ latitude: 19.0760, longitude: 72.8777 }) });
  const inRes = await fetch(`${BASE}/api/geo/checkin`, { method: "POST", headers: auth, body: JSON.stringify({ latitude: gf.centerLat, longitude: gf.centerLng }) });
  const inJson = (await inRes.json()) as any;
  console.log(`  geo/checkin (inside) → HTTP ${inRes.status}: entered=${JSON.stringify(inJson?.data?.entered ?? [])}`);

  // ---------- SCRAPE /metrics ----------
  await new Promise((r) => setTimeout(r, 400));
  const checkoutM = await metricLine('homigo_feature_events_total{feature="checkout"');
  const geofenceM = await metricLine('homigo_feature_events_total{feature="geofence"');
  console.log("\n=== /metrics evidence ===");
  checkoutM.forEach((l) => console.log("  " + l));
  geofenceM.forEach((l) => console.log("  " + l));

  const okCheckout = checkoutM.some((l) => /\}\s+[1-9]/.test(l));
  const okGeofence = geofenceM.some((l) => /\}\s+[1-9]/.test(l));
  console.log(`\ncheckout metric live: ${okCheckout ? "✅ YES" : "❌ NO"}`);
  console.log(`geofence metric live: ${okGeofence ? "✅ YES" : "❌ NO"}`);
  process.exit(okCheckout && okGeofence ? 0 : 1);
}

main().catch((e) => { console.error("❌", e instanceof Error ? e.message : e); process.exit(1); });
