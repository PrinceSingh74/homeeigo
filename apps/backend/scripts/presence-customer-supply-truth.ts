/**
 * Customer supply-truth proof against a live API (staging or dev).
 *
 *   HOMIGO_STAGING=1 E2E_API_URL=http://127.0.0.1:3010 bun run scripts/presence-customer-supply-truth.ts
 */
import "../src/load-env";
import prisma from "../src/lib/prisma";
import { RefreshTokenService } from "../src/services/refresh-token.service";
import { JWTService } from "../src/services/jwt.service";

const API = (process.env.E2E_API_URL ?? "http://127.0.0.1:3010").replace(/\/$/, "");
const FORBIDDEN = /\b(STALE|EXPIRED|SUSPENDED|Online)\b/;

type Status = "PASS" | "FAIL" | "BLOCKED";
const results: Array<{ gate: string; status: Status; detail: string }> = [];

function rec(gate: string, status: Status, detail: string) {
  results.push({ gate, status, detail });
  console.log(`${status.padEnd(8)} ${gate} — ${detail}`);
}

function assertNoRaw(payload: unknown, gate: string) {
  const raw = JSON.stringify(payload);
  if (FORBIDDEN.test(raw)) {
    rec(gate, "FAIL", `customer payload leaked internal token: ${raw.slice(0, 400)}`);
    return false;
  }
  rec(gate, "PASS", "no STALE/EXPIRED/SUSPENDED/Online in customer payload");
  return true;
}

async function main() {
  const health = await fetch(`${API}/health`).then((r) => r.json()) as {
    environment?: string;
    services?: { database?: string };
  };
  rec("env.api", health.services?.database === "ok" ? "PASS" : "FAIL", JSON.stringify(health));

  const provider = await prisma.provider.findFirst({
    where: { lifecycleState: "ACTIVE", isApproved: true, isBanned: false, isActive: true },
    select: { id: true, userId: true, isOnline: true },
  });
  if (!provider) throw new Error("no ACTIVE provider");
  rec("provider", "PASS", provider.id);

  const deviceId = `supply-${Date.now().toString(36)}`;
  const tokens = await new RefreshTokenService(prisma, new JWTService()).createSessionTokens({
    userId: provider.userId,
    email: `supply+${provider.userId.slice(-8)}@homigo.local`,
    deviceId,
  });

  await fetch(`${API}/api/providers/me/online`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${tokens.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ online: true }),
  });

  const snapRes = await fetch(`${API}/api/providers/me/presence`, {
    headers: { Authorization: `Bearer ${tokens.accessToken}` },
  });
  const snapJson = (await snapRes.json()) as {
    data?: {
      sessionId?: string;
      location?: { sequence?: number | null; latitude?: number; longitude?: number; capturedAt?: string | null };
    };
  };
  const snap = snapJson.data ?? {};
  const sessionId = snap.sessionId ?? tokens.sessionId;
  const seq0 = Number(snap.location?.sequence ?? 0);
  const lat0 = Number(snap.location?.latitude ?? 28.6139);
  const lng0 = Number(snap.location?.longitude ?? 77.209);
  const lastCapturedMs = snap.location?.capturedAt ? Date.parse(String(snap.location.capturedAt)) : 0;
  const capturedAt = new Date(Math.max(Date.now() - 2_000, lastCapturedMs + 1));

  const beat = await fetch(`${API}/api/providers/me/presence/heartbeat`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tokens.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId,
      deviceId,
      timestamp: new Date().toISOString(),
      appState: "foreground",
      platform: "web",
      availabilityTelemetry: "AVAILABLE",
      location: {
        latitude: lat0 + 0.00002,
        longitude: lng0,
        accuracy: 12,
        capturedAt: capturedAt.toISOString(),
        sequence: seq0 + 1,
      },
    }),
  });
  const beatBody = await beat.json().catch(() => ({}));
  rec("heartbeat", beat.ok ? "PASS" : "FAIL", `http=${beat.status} body=${JSON.stringify(beatBody).slice(0, 240)}`);

  const fresh = await fetch(`${API}/api/providers/${provider.id}`).then((r) => r.json()) as {
    data?: { provider?: { availableNow?: boolean; availabilityLabel?: string } };
  };
  const labelFresh = fresh.data?.provider?.availabilityLabel;
  rec(
    "fresh.label",
    labelFresh === "Available now" ? "PASS" : "FAIL",
    `availableNow=${String(fresh.data?.provider?.availableNow)} label=${labelFresh ?? "missing"}`,
  );
  assertNoRaw(fresh.data?.provider, "fresh.no_raw");

  const nearbyFresh = await fetch(`${API}/api/providers/nearby?latitude=28.62&longitude=77.37&limit=20`).then((r) =>
    r.json(),
  );
  assertNoRaw(nearbyFresh, "nearby.fresh.no_raw");

  await prisma.partnerPresence.update({
    where: { providerId: provider.id },
    data: { lastHeartbeatAt: new Date(Date.now() - 120_000) },
  });
  const stale = await fetch(`${API}/api/providers/${provider.id}`).then((r) => r.json()) as {
    data?: { provider?: { availableNow?: boolean; availabilityLabel?: string } };
  };
  const labelStale = stale.data?.provider?.availabilityLabel;
  rec(
    "stale.label",
    labelStale === "Confirming professional" || labelStale === "Limited availability" || labelStale === "Unavailable"
      ? "PASS"
      : "FAIL",
    `availableNow=${String(stale.data?.provider?.availableNow)} label=${labelStale ?? "missing"}`,
  );
  rec(
    "stale.not_available_now",
    stale.data?.provider?.availableNow === false ? "PASS" : "FAIL",
    `availableNow=${String(stale.data?.provider?.availableNow)}`,
  );
  assertNoRaw(stale.data?.provider, "stale.no_raw");

  const axes = await prisma.provider.findUnique({
    where: { id: provider.id },
    select: { lifecycleState: true, isOnline: true, pausedAt: true },
  });
  rec(
    "axes.untouched",
    axes?.lifecycleState === "ACTIVE" && axes.isOnline ? "PASS" : "FAIL",
    JSON.stringify(axes),
  );

  const fail = results.filter((r) => r.status === "FAIL").length;
  const pass = results.filter((r) => r.status === "PASS").length;
  const blocked = results.filter((r) => r.status === "BLOCKED").length;
  console.log(`SUMMARY pass=${pass} fail=${fail} blocked=${blocked}`);
  process.exit(fail > 0 ? 2 : 0);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
