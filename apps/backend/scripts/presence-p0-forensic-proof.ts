/**
 * Live forensic proof: client-shaped heartbeat → Postgres → Redis → eligibility,
 * then fail-closed expiry without four-axis mutation.
 *
 *   bun --env-file=.env run scripts/presence-p0-forensic-proof.ts
 */
import "../src/load-env";
import prisma from "../src/lib/prisma";
import { redisClient } from "../src/lib/redis";
import { PRESENCE_REDIS_KEY } from "../src/lib/partner-presence.config";

const API = (process.env.E2E_API_URL ?? "http://localhost:3000").replace(/\/$/, "");
const EMAIL = "partner@homigo.demo";
const PASSWORD = "Homigo@123";
const DEVICE = `forensic-presence-${Date.now().toString(36)}`;

type Status = "PASS" | "FAIL" | "BLOCKED";
const results: Array<{ gate: string; status: Status; detail: string }> = [];

function rec(gate: string, status: Status, detail: string) {
  results.push({ gate, status, detail });
  console.log(`${status.padEnd(8)} ${gate} — ${detail}`);
}

async function mintSession(deviceId: string) {
  const res = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, deviceId, setAuthCookies: false }),
  });
  const json = (await res.json()) as {
    data?: { accessToken?: string; sessionId?: string; userId?: string };
    error?: string;
  };
  if (res.ok && json.data?.accessToken && json.data.sessionId && json.data.userId) {
    rec("auth.password_login", "PASS", `http=${res.status}`);
    return json.data as { accessToken: string; sessionId: string; userId: string };
  }
  rec(
    "auth.password_login",
    "BLOCKED",
    `http=${res.status} ${json.error ?? ""} — minting session via RefreshTokenService (HTTP heartbeat still used)`,
  );
  const provider = await prisma.provider.findFirst({
    where: { lifecycleState: "ACTIVE", isApproved: true, isBanned: false, isActive: true },
    select: { id: true, userId: true },
    orderBy: { updatedAt: "desc" },
  });
  if (!provider) throw new Error("no ACTIVE approved provider in homigo_db");
  rec("auth.provider_selected", "PASS", provider.id);
  const { RefreshTokenService } = await import("../src/services/refresh-token.service");
  const { JWTService } = await import("../src/services/jwt.service");
  const tokens = await new RefreshTokenService(prisma, new JWTService()).createSessionTokens({
    userId: provider.userId,
    email: EMAIL,
    deviceId,
  });
  return { accessToken: tokens.accessToken, sessionId: tokens.sessionId, userId: provider.userId };
}

async function api(method: string, path: string, token: string, body?: unknown) {
  const t0 = Date.now();
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json, ms: Date.now() - t0 };
}

async function main() {
  const health = await fetch(`${API}/health`).then((r) => r.json()) as {
    services?: { database?: string; redis?: string };
  };
  rec("env.api", health.services?.database === "ok" ? "PASS" : "FAIL", JSON.stringify(health.services));
  await redisClient.connect().catch(() => {});
  rec("env.redis_client", redisClient.isAvailable ? "PASS" : "FAIL", `enabled=${redisClient.isEnabled} available=${redisClient.isAvailable}`);

  const auth = await mintSession(DEVICE);
  rec("auth.sessionId", auth.sessionId ? "PASS" : "FAIL", `sessionId=${auth.sessionId?.slice(0, 12)}`);

  const me = await api("GET", "/api/providers/me", auth.accessToken);
  const provider = (me.json.data as { provider?: { id?: string } } | undefined)?.provider
    ?? (me.json.data as { id?: string } | undefined);
  const providerId =
    (provider && "id" in provider ? provider.id : undefined) ??
    (await prisma.provider.findFirst({ where: { userId: auth.userId }, select: { id: true } }))?.id;
  if (!providerId) {
    rec("provider.me", "BLOCKED", "no provider for demo partner");
    process.exit(2);
  }
  rec("provider.me", "PASS", providerId);

  const before = await prisma.provider.findUnique({
    where: { id: providerId },
    select: { lifecycleState: true, isOnline: true, pausedAt: true, currentStatus: true },
  });
  const earningsBefore = await prisma.earning.count({ where: { providerId } });
  const jobsBefore = await prisma.booking.count({
    where: { providerId, status: { in: ["ACCEPTED", "ASSIGNED", "EN_ROUTE", "IN_PROGRESS"] } },
  });

  const online = await api("PUT", "/api/providers/me/online", auth.accessToken, { online: true });
  rec("availability.go_online", online.status === 200 ? "PASS" : "FAIL", `http=${online.status}`);

  const snap0 = await api("GET", "/api/providers/me/presence", auth.accessToken);
  const snapData = (snap0.json.data ?? snap0.json) as Record<string, unknown>;
  rec(
    "presence.bootstrap",
    snap0.status === 200 ? "PASS" : "FAIL",
    `http=${snap0.status} session=${String(snapData.sessionId ?? "")} interval=${String(snapData.heartbeatIntervalSeconds ?? "")}`,
  );

  const sessionId = String(snapData.sessionId ?? auth.sessionId);
  const loc0 = snapData.location as
    | { sequence?: number | null; latitude?: number; longitude?: number; capturedAt?: string | null }
    | null
    | undefined;
  const seq0 = Number(loc0?.sequence ?? 0);
  const lat0 = Number(loc0?.latitude ?? 28.6139);
  const lng0 = Number(loc0?.longitude ?? 77.209);
  const lastCapturedMs = loc0?.capturedAt ? Date.parse(String(loc0.capturedAt)) : 0;
  const capturedAt = new Date(Math.max(Date.now() - 2_000, lastCapturedMs + 1));
  const beat = await api("POST", "/api/providers/me/presence/heartbeat", auth.accessToken, {
    sessionId,
    deviceId: DEVICE,
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
  });
  const beatData = (beat.json.data ?? beat.json) as Record<string, unknown>;
  rec(
    "heartbeat.http",
    beat.status === 200 && (beatData as { accepted?: boolean }).accepted !== false ? "PASS" : "FAIL",
    `http=${beat.status} ms=${beat.ms} body=${JSON.stringify(beat.json).slice(0, 240)}`,
  );

  const row = await prisma.partnerPresence.findUnique({ where: { providerId } });
  rec(
    "postgres.heartbeat",
    row?.lastHeartbeatAt != null ? "PASS" : "FAIL",
    `lastHeartbeatAt=${row?.lastHeartbeatAt?.toISOString() ?? "null"}`,
  );
  rec(
    "postgres.captured_vs_received",
    row?.lastLocationAt != null && row.lastLocationReceivedAt != null ? "PASS" : "FAIL",
    `captured=${row?.lastLocationAt?.toISOString() ?? "null"} received=${row?.lastLocationReceivedAt?.toISOString() ?? "null"} lagMs=${
      row?.lastLocationAt && row.lastLocationReceivedAt
        ? row.lastLocationReceivedAt.getTime() - row.lastLocationAt.getTime()
        : "n/a"
    }`,
  );

  const redisRaw = await redisClient.get(PRESENCE_REDIS_KEY(providerId));
  rec("redis.ttl_key", redisRaw ? "PASS" : "FAIL", redisRaw ? redisRaw.slice(0, 160) : "missing");

  const elig = await api("GET", "/api/providers/me/dispatch-eligibility", auth.accessToken);
  const eligData = (elig.json.data ?? elig.json) as {
    eligible?: boolean;
    blockedBy?: string | null;
    reasons?: string[];
    checks?: Record<string, boolean>;
  };
  rec(
    "eligibility.after_heartbeat",
    elig.status === 200 && eligData.eligible === true ? "PASS" : "FAIL",
    `http=${elig.status} eligible=${String(eligData.eligible)} blockedBy=${String(eligData.blockedBy)} reasons=${JSON.stringify(eligData.reasons)}`,
  );

  const future = await api("POST", "/api/providers/me/presence/heartbeat", auth.accessToken, {
    sessionId,
    deviceId: DEVICE,
    timestamp: new Date(Date.now() + 120_000).toISOString(),
  });
  rec(
    "security.future_timestamp",
    future.status >= 400 ? "PASS" : "FAIL",
    `http=${future.status} code=${JSON.stringify((future.json as { code?: string }).code ?? future.json)}`,
  );

  const old = await api("POST", "/api/providers/me/presence/heartbeat", auth.accessToken, {
    sessionId,
    deviceId: DEVICE,
    timestamp: new Date(Date.now() - 400_000).toISOString(),
  });
  rec(
    "security.old_timestamp",
    old.status >= 400 ? "PASS" : "FAIL",
    `http=${old.status}`,
  );

  const wrongDevice = await api("POST", "/api/providers/me/presence/heartbeat", auth.accessToken, {
    sessionId,
    deviceId: "spoofed-other-device",
    timestamp: new Date().toISOString(),
  });
  rec(
    "security.device_mismatch",
    wrongDevice.status >= 400 ? "PASS" : "FAIL",
    `http=${wrongDevice.status} ${JSON.stringify(wrongDevice.json).slice(0, 180)}`,
  );

  const jump = await api("POST", "/api/providers/me/location/ping", auth.accessToken, {
    sessionId,
    deviceId: DEVICE,
    location: {
      latitude: 19.076,
      longitude: 72.8777,
      accuracy: 8,
      capturedAt: new Date().toISOString(),
      sequence: seq0 + 2,
    },
  });
  rec(
    "location.impossible_jump",
    jump.status >= 400 ? "PASS" : "FAIL",
    `http=${jump.status} ${JSON.stringify(jump.json).slice(0, 180)}`,
  );

  const pingOnly = await api("POST", "/api/providers/me/location/ping", auth.accessToken, {
    sessionId,
    deviceId: DEVICE,
    location: {
      latitude: lat0 + 0.00004,
      longitude: lng0,
      accuracy: 10,
      capturedAt: new Date().toISOString(),
      sequence: seq0 + 3,
    },
  });
  rec(
    "location.ping_http",
    pingOnly.status === 200 || pingOnly.status >= 400 ? (pingOnly.status === 200 ? "PASS" : "FAIL") : "FAIL",
    `http=${pingOnly.status} ${JSON.stringify(pingOnly.json).slice(0, 160)}`,
  );

  const hbBeforePing = row?.lastHeartbeatAt?.toISOString();
  const afterPing = await prisma.partnerPresence.findUnique({
    where: { providerId },
    select: { lastHeartbeatAt: true, lastLocationAt: true },
  });
  rec(
    "location.ping_does_not_advance_heartbeat",
    afterPing?.lastHeartbeatAt?.toISOString() === hbBeforePing || pingOnly.status >= 400 ? "PASS" : "FAIL",
    `before=${hbBeforePing} after=${afterPing?.lastHeartbeatAt?.toISOString() ?? "null"} pingHttp=${pingOnly.status}`,
  );

  await prisma.partnerPresence.update({
    where: { providerId },
    data: { lastHeartbeatAt: new Date(Date.now() - 90_000) },
  });
  const staleElig = await api("GET", "/api/providers/me/dispatch-eligibility", auth.accessToken);
  const staleData = (staleElig.json.data ?? staleElig.json) as {
    eligible?: boolean;
    blockedBy?: string | null;
    reasons?: string[];
  };
  rec(
    "fail_closed.stale_presence",
    staleElig.status === 200 && staleData.eligible === false && (staleData.reasons ?? []).includes("STALE_PRESENCE")
      ? "PASS"
      : "FAIL",
    `eligible=${String(staleData.eligible)} blockedBy=${String(staleData.blockedBy)} reasons=${JSON.stringify(staleData.reasons)}`,
  );

  const afterAxes = await prisma.provider.findUnique({
    where: { id: providerId },
    select: { lifecycleState: true, isOnline: true, pausedAt: true, currentStatus: true },
  });
  const earningsAfter = await prisma.earning.count({ where: { providerId } });
  const jobsAfter = await prisma.booking.count({
    where: { providerId, status: { in: ["ACCEPTED", "ASSIGNED", "EN_ROUTE", "IN_PROGRESS"] } },
  });
  rec(
    "four_axis.lifecycle_untouched",
    afterAxes?.lifecycleState === before?.lifecycleState ? "PASS" : "FAIL",
    `${before?.lifecycleState} → ${afterAxes?.lifecycleState}`,
  );
  rec(
    "four_axis.availability_not_suspended",
    afterAxes?.isOnline === true && afterAxes.lifecycleState !== "SUSPENDED" ? "PASS" : "FAIL",
    `isOnline=${String(afterAxes?.isOnline)} lifecycle=${afterAxes?.lifecycleState} pausedAt=${afterAxes?.pausedAt?.toISOString() ?? "null"}`,
  );
  rec(
    "four_axis.jobs_untouched",
    jobsAfter === jobsBefore ? "PASS" : "FAIL",
    `${jobsBefore} → ${jobsAfter}`,
  );
  rec(
    "four_axis.finance_untouched",
    earningsAfter === earningsBefore ? "PASS" : "FAIL",
    `${earningsBefore} → ${earningsAfter}`,
  );

  const auth2 = await mintSession(`${DEVICE}-b`);
  const snapB = await api("GET", "/api/providers/me/presence", auth2.accessToken);
  const sessionB = String(((snapB.json.data ?? snapB.json) as { sessionId?: string }).sessionId ?? auth2.sessionId);
  const staleSession = await api("POST", "/api/providers/me/presence/heartbeat", auth.accessToken, {
    sessionId,
    deviceId: DEVICE,
    timestamp: new Date().toISOString(),
  });
  rec(
    "session.a_rejected_after_b",
    staleSession.status >= 400 ? "PASS" : "FAIL",
    `http=${staleSession.status} sessionB=${sessionB.slice(0, 12)} ${JSON.stringify(staleSession.json).slice(0, 160)}`,
  );

  const restoreBeat = await api("POST", "/api/providers/me/presence/heartbeat", auth2.accessToken, {
    sessionId: sessionB,
    deviceId: `${DEVICE}-b`,
    timestamp: new Date().toISOString(),
  });
  rec(
    "session.b_heartbeat",
    restoreBeat.status === 200 ? "PASS" : "FAIL",
    `http=${restoreBeat.status} ${JSON.stringify(restoreBeat.json).slice(0, 160)}`,
  );

  const redisAfter = await redisClient.get(PRESENCE_REDIS_KEY(providerId));
  rec(
    "redis.ttl_key_after_accepted_beat",
    redisAfter ? "PASS" : "FAIL",
    redisAfter ? redisAfter.slice(0, 160) : "missing after accepted heartbeat",
  );

  const pass = results.filter((r) => r.status === "PASS").length;
  const fail = results.filter((r) => r.status === "FAIL").length;
  const blocked = results.filter((r) => r.status === "BLOCKED").length;
  console.log(`\nSUMMARY pass=${pass} fail=${fail} blocked=${blocked}`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
