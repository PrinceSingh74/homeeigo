import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import crypto from "crypto";
import app from "../index";
import { verifySvixSignature } from "../routes/webhooks";
import {
  cleanupAdversarialFixtures,
  dbReachable,
  prisma,
  seedAdversarialFixtures,
  type AdvCtx,
} from "./helpers/adversarial-fixtures";
import { JWTService } from "../services/jwt.service";

/**
 * Red-team closures: each case is the exact request the finding described, sent through the real
 * app, asserting the refusal (or the minimal payload) the fix promised.
 */
const RUN = `rt-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let reachable = false;
const jwt = new JWTService();

function bearerFor(userId: string, role: "CUSTOMER" | "VENDOR" | "ADMIN" = "CUSTOMER") {
  void role;
  return `Bearer ${jwt.generateAccessToken({ userId, email: `${userId}@adv.test` })}`;
}
const get = (path: string, headers: Record<string, string> = {}) =>
  app.handle(new Request(`http://localhost${path}`, { headers }));

beforeAll(async () => {
  reachable = await dbReachable();
  if (!reachable) return;
  ctx = await seedAdversarialFixtures(RUN);
}, 60_000);
afterAll(async () => {
  if (!reachable) return;
  await cleanupAdversarialFixtures(RUN);
}, 60_000);

describe("Svix verification for the Resend webhook", () => {
  const secret = Buffer.from("test-secret-bytes-0123456789");
  const body = JSON.stringify({ type: "email.bounced", data: { email: "victim@example.com" } });
  const id = "msg_123";
  const now = 1_800_000_000;
  const sign = (ts: number, key = secret) =>
    `v1,${crypto.createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64")}`;

  it("accepts a correctly signed event inside the window", () => {
    expect(verifySvixSignature(body, { id, timestamp: String(now), signature: sign(now) }, secret, now)).toEqual({ ok: true });
  });
  it("accepts a rotated-key header carrying several signatures", () => {
    const sig = `${sign(now, Buffer.from("old-key"))} ${sign(now)}`;
    expect(verifySvixSignature(body, { id, timestamp: String(now), signature: sig }, secret, now).ok).toBe(true);
  });
  it("refuses a wrong key, a tampered body, a replay outside the window, missing headers, and no secret", () => {
    expect(verifySvixSignature(body, { id, timestamp: String(now), signature: sign(now, Buffer.from("wrong")) }, secret, now)).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifySvixSignature(body + " ", { id, timestamp: String(now), signature: sign(now) }, secret, now).ok).toBe(false);
    expect(verifySvixSignature(body, { id, timestamp: String(now - 600), signature: sign(now - 600) }, secret, now)).toEqual({ ok: false, reason: "timestamp_out_of_window" });
    expect(verifySvixSignature(body, { id: null, timestamp: String(now), signature: sign(now) }, secret, now)).toEqual({ ok: false, reason: "missing_headers" });
    expect(verifySvixSignature(body, { id, timestamp: String(now), signature: sign(now) }, null, now)).toEqual({ ok: false, reason: "secret_not_configured" });
  });
  it("the legacy hex-HMAC-of-body header is refused (what the old verifier accepted)", () => {
    const legacy = crypto.createHmac("sha256", secret).update(body).digest("hex");
    expect(verifySvixSignature(body, { id, timestamp: String(now), signature: legacy }, secret, now).ok).toBe(false);
  });
  it("over the wire: an unsigned forged suppression event is refused with 401 and nothing is suppressed", async () => {
    if (!reachable) return;
    const res = await app.handle(
      new Request("http://localhost/api/webhooks/resend", {
        method: "POST",
        headers: { "content-type": "application/json", "svix-signature": "v1,AAAA" },
        body,
      }),
    );
    expect(res.status).toBe(401);
    const log = await prisma.emailLog.findFirst({ where: { to: "victim@example.com", status: "bounced" } }).catch(() => null);
    expect(log).toBeNull();
  });
});

describe("geo routes", () => {
  it("/config now requires a session", async () => {
    if (!reachable) return;
    expect((await get("/api/geo/config")).status).toBe(401);
    expect((await get("/api/geo/config", { authorization: bearerFor(ctx.customerA.id) })).status).toBe(200);
  });
  it("/place rejects a malformed place id before touching the provider", async () => {
    if (!reachable) return;
    const res = await get("/api/geo/place/%3Cscript%3E", { authorization: bearerFor(ctx.customerA.id) });
    expect(res.status).toBe(400);
  });
  it("/route and /eta refuse coordinates outside the service area", async () => {
    if (!reachable) return;
    const h = { authorization: bearerFor(ctx.customerA.id) };
    expect((await get("/api/geo/route?fromLat=51.5&fromLng=-0.1&toLat=51.6&toLng=-0.2", h)).status).toBe(400);
    expect((await get("/api/geo/eta?fromLat=51.5&fromLng=-0.1&toLat=51.6&toLng=-0.2", h)).status).toBe(400);
  });
  it("/place is rate limited per user (30/min) and the limit is per user, not global", async () => {
    if (!reachable) return;
    // Without a Maps key the provider call short-circuits, so this measures only the limiter.
    const statuses: number[] = [];
    for (let i = 0; i < 35; i++) {
      statuses.push((await get(`/api/geo/place/ChIJ_test_place_${i}`, { authorization: bearerFor(ctx.customerB.id) })).status);
    }
    expect(statuses.slice(0, 30).every((s) => s !== 429)).toBe(true);
    expect(statuses.slice(30).every((s) => s === 429)).toBe(true);
    // Another user is unaffected.
    expect((await get("/api/geo/place/ChIJ_other_user", { authorization: bearerFor(ctx.customerA.id) })).status).not.toBe(429);
  }, 60_000);
});

describe("public provider availability", () => {
  it("validates date and serviceId", async () => {
    if (!reachable) return;
    expect((await get(`/api/providers/${ctx.providerId}/availability?date=undefined&serviceId=${ctx.serviceId}`)).status).toBe(400);
    expect((await get(`/api/providers/${ctx.providerId}/availability?date=2026-10-01`)).status).toBe(400);
  });
  it("exposes no operational counters to an anonymous caller", async () => {
    if (!reachable) return;
    const res = await get(`/api/providers/${ctx.providerId}/availability?date=2026-10-01&serviceId=${ctx.serviceId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { capacity: Record<string, unknown> } };
    expect(Object.keys(body.data.capacity).sort()).toEqual(["remainingSlots"]);
    for (const k of ["currentJobs", "reservedOffers", "jobsToday", "maxConcurrentJobs", "maxJobsPerDay"]) {
      expect(JSON.stringify(body.data)).not.toContain(k);
    }
  });
});
