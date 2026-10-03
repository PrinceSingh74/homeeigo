/**
 * Dedicated presence load baseline (not booking/wallet k6).
 *
 *   HOMIGO_STAGING=1 bun run scripts/presence-load-baseline.ts --n=100
 *
 * Seeds N ACTIVE+AVAILABLE partners on the connected database, mints real
 * RefreshTokenService sessions, then heartbeats with per-partner jitter so
 * timers are not synchronized to the same millisecond.
 */
import "../src/load-env";
import prisma from "../src/lib/prisma";
import { RefreshTokenService } from "../src/services/refresh-token.service";
import { JWTService } from "../src/services/jwt.service";

const API = (process.env.E2E_API_URL ?? "http://127.0.0.1:3010").replace(/\/$/, "");
const N = Math.max(1, Number(process.argv.find((a) => a.startsWith("--n="))?.slice(4) ?? 100));
const ROUNDS = Math.max(1, Number(process.argv.find((a) => a.startsWith("--rounds="))?.slice(9) ?? 1));
const JITTER_MS = Math.max(1, Number(process.argv.find((a) => a.startsWith("--jitter="))?.slice(9) ?? 25_000));
const CONCURRENCY = Math.max(1, Number(process.argv.find((a) => a.startsWith("--concurrency="))?.slice(14) ?? 20));
const TAG = "presence-load";
const LAT = 28.62;
const LNG = 77.37;

type PartnerRow = { id: string; userId: string; deviceId: string; sessionId: string; token: string };

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensurePartners(count: number): Promise<Array<{ id: string; userId: string }>> {
  const existing = await prisma.provider.findMany({
    where: { businessName: { startsWith: `${TAG}-` } },
    select: { id: true, userId: true },
    orderBy: { createdAt: "asc" },
  });
  if (existing.length >= count) return existing.slice(0, count);

  const start = existing.length;
  const users = [];
  for (let i = start; i < count; i++) {
    const slot = String(i).padStart(5, "0");
    users.push({
      // Load-generation accounts, declared so they can never be counted as real partners.
      dataOrigin: "SYNTHETIC" as const,
      email: `${TAG}-${slot}@staging.homigo.local`,
      phoneNumber: `+91${(9800000000 + i).toString()}`,
      firstName: "Load",
      lastName: slot,
      password: "unused-load-hash",
      role: "VENDOR" as const,
      isEmailVerified: true,
      isPhoneVerified: true,
      isActive: true,
    });
  }
  await prisma.user.createMany({ data: users, skipDuplicates: true });
  const createdUsers = await prisma.user.findMany({
    where: { email: { startsWith: `${TAG}-` } },
    select: { id: true, email: true },
  });
  const byEmail = new Map(createdUsers.map((u) => [u.email, u.id]));
  const providers = [];
  for (let i = start; i < count; i++) {
    const slot = String(i).padStart(5, "0");
    const userId = byEmail.get(`${TAG}-${slot}@staging.homigo.local`);
    if (!userId) continue;
    providers.push({
      userId,
      businessName: `${TAG}-${slot}`,
      serviceRegions: ["Noida"],
      serviceCategories: ["cleaning"],
      lifecycleState: "ACTIVE" as const,
      isVerified: true,
      isApproved: true,
      isActive: true,
      isOnline: true,
      isBanned: false,
      city: "Noida",
      baseLatitude: LAT,
      baseLongitude: LNG,
      workingDays: [] as string[],
    });
  }
  await prisma.provider.createMany({ data: providers, skipDuplicates: true });
  const all = await prisma.provider.findMany({
    where: { businessName: { startsWith: `${TAG}-` } },
    select: { id: true, userId: true },
    orderBy: { createdAt: "asc" },
  });
  const locations = all.map((p, i) => ({
    providerId: p.id,
    latitude: LAT + (i % 50) * 0.0002,
    longitude: LNG + Math.floor(i / 50) * 0.0002,
  }));
  await prisma.location.createMany({ data: locations, skipDuplicates: true });
  return all.slice(0, count);
}

async function mint(rows: Array<{ id: string; userId: string }>): Promise<PartnerRow[]> {
  const svc = new RefreshTokenService(prisma, new JWTService());
  const out: PartnerRow[] = [];
  const batch = 25;
  for (let i = 0; i < rows.length; i += batch) {
    const slice = rows.slice(i, i + batch);
    const minted = await Promise.all(
      slice.map(async (row) => {
        const deviceId = `load-${row.id.slice(-8)}`;
        const tokens = await svc.createSessionTokens({
          userId: row.userId,
          email: `load+${row.userId.slice(-8)}@homigo.local`,
          deviceId,
          deviceName: "presence-load",
        });
        return {
          id: row.id,
          userId: row.userId,
          deviceId,
          sessionId: tokens.sessionId,
          token: tokens.accessToken,
        };
      }),
    );
    out.push(...minted);
  }
  return out;
}

async function beat(row: PartnerRow, seq: number): Promise<{ ms: number; status: number; ok: boolean }> {
  const t0 = Date.now();
  const res = await fetch(`${API}/api/providers/me/presence/heartbeat`, {
    method: "POST",
    headers: { Authorization: `Bearer ${row.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: row.sessionId,
      deviceId: row.deviceId,
      timestamp: new Date().toISOString(),
      appState: "foreground",
      platform: "web",
      location: {
        latitude: LAT,
        longitude: LNG,
        accuracy: 12,
        capturedAt: new Date().toISOString(),
        sequence: Math.floor(Date.now() / 1000) + seq,
      },
    }),
  });
  return { ms: Date.now() - t0, status: res.status, ok: res.ok };
}

async function eligibility(row: PartnerRow): Promise<{ eligible: boolean; blockedBy: string | null }> {
  const res = await fetch(`${API}/api/providers/me/dispatch-eligibility`, {
    headers: { Authorization: `Bearer ${row.token}` },
  });
  const json = (await res.json()) as { data?: { eligible?: boolean; blockedBy?: string | null } };
  return { eligible: Boolean(json.data?.eligible), blockedBy: json.data?.blockedBy ?? null };
}

async function sampleInfra() {
  const pg = await prisma.$queryRaw<Array<{ connections: bigint }>>`
    SELECT COUNT(*)::bigint AS connections FROM pg_stat_activity
  `.catch(() => [{ connections: 0n }]);
  return { pgConnections: Number(pg[0]?.connections ?? 0) };
}

async function main() {
  const health = await fetch(`${API}/health`).then((r) => r.json()) as {
    environment?: string;
    services?: { database?: string; redis?: string };
  };
  if (health.services?.database !== "ok") {
    throw new Error(`API not healthy: ${JSON.stringify(health)}`);
  }

  const tSeed = Date.now();
  const providers = await ensurePartners(N);
  const partners = await mint(providers);
  const seedMs = Date.now() - tSeed;
  const latencies: number[] = [];
  let errors = 0;
  let retries = 0;
  const statuses: Record<number, number> = {};

  const wall0 = Date.now();
  for (let round = 1; round <= ROUNDS; round++) {
    const schedule = partners.map((p, i) => ({ p, i, at: Math.random() * JITTER_MS }));
    schedule.sort((a, b) => a.at - b.at);
    const roundResults: Array<{ ms: number; status: number; ok: boolean }> = new Array(partners.length);
    const started = Date.now();
    let cursor = 0;
    async function worker() {
      for (;;) {
        const item = schedule[cursor++];
        if (!item) return;
        const wait = item.at - (Date.now() - started);
        if (wait > 0) await sleep(wait);
        roundResults[item.i] = await beat(item.p, round);
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, partners.length) }, () => worker()));
    const results = roundResults;
    for (const r of results) {
      latencies.push(r.ms);
      statuses[r.status] = (statuses[r.status] ?? 0) + 1;
      if (!r.ok) {
        errors += 1;
        if (r.status === 429) retries += 1;
      }
    }
  }
  const wallMs = Date.now() - wall0;
  const sorted = [...latencies].sort((a, b) => a - b);
  const beats = latencies.length;
  const rps = beats / (wallMs / 1000);

  const sample = partners.slice(0, Math.min(20, partners.length));
  const elig = await Promise.all(sample.map(eligibility));
  const eligibleCount = elig.filter((e) => e.eligible).length;
  const staleBlocked = elig.filter((e) => e.blockedBy === "STALE_PRESENCE").length;

  const control = partners[0]!;
  await prisma.partnerPresence.update({
    where: { providerId: control.id },
    data: { lastHeartbeatAt: new Date(Date.now() - 120_000) },
  });
  const afterAge = await eligibility(control);
  const axes = await prisma.provider.findUnique({
    where: { id: control.id },
    select: { lifecycleState: true, isOnline: true, pausedAt: true, totalEarningsPaise: true },
  });
  const jobs = await prisma.booking.count({ where: { providerId: control.id } });
  const infra = await sampleInfra();

  const report = {
    n: partners.length,
    rounds: ROUNDS,
    jitterMs: JITTER_MS,
    concurrency: CONCURRENCY,
    environment: health.environment,
    seedMs,
    wallMs,
    beats,
    rps: Number(rps.toFixed(2)),
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    errors,
    retries,
    statuses,
    eligibilitySample: { n: sample.length, eligible: eligibleCount, staleBlocked },
    agedControl: afterAge,
    fourAxis: {
      lifecycle: axes?.lifecycleState,
      isOnline: axes?.isOnline,
      pausedAt: axes?.pausedAt,
      earningsPaise: String(axes?.totalEarningsPaise ?? 0),
      jobs,
    },
    pgConnections: infra.pgConnections,
  };
  console.log(JSON.stringify(report, null, 2));

  const failed =
    errors > 0 ||
    afterAge.eligible ||
    afterAge.blockedBy !== "STALE_PRESENCE" ||
    axes?.lifecycleState !== "ACTIVE" ||
    axes?.isOnline !== true ||
    jobs !== 0;
  process.exit(failed ? 2 : 0);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
