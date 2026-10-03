/**
 * Coding-phase gap closure 2026-09-28: the generic idempotency middleware keyed its replay cache on
 * (raw Authorization header, Idempotency-Key) only. Two defects followed:
 *
 *   1. A key reused with a DIFFERENT body — or on a different endpoint — was answered with the FIRST
 *      request's response. The new request never ran and the client was told it succeeded
 *      (`set-default` returned the address-create response, 201, without executing). The booking
 *      route's own guard already refuses that case with 409 IDEMPOTENCY_KEY_REUSED, but the
 *      middleware short-circuited before the route could run.
 *   2. The namespace was the raw bearer token, so a replay carrying a refreshed access token for the
 *      same customer missed the cache and executed a second time — the duplicate the middleware
 *      exists to prevent, on exactly the path it was built for (the offline queue replays after
 *      connectivity returns, by which time the token has usually been refreshed).
 *
 * The contract pinned here: same customer + same key + same request → the original outcome is
 * replayed and nothing runs twice; same key + a different request → 409 IDEMPOTENCY_KEY_REUSED.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import app from "../index";
import prisma from "../lib/prisma";
import { JWTService } from "../services/jwt.service";
import { cleanupAdversarialFixtures, dbReachable, seedAdversarialFixtures, type AdvCtx } from "./helpers/adversarial-fixtures";

const RUN = `idk-${Date.now().toString(36)}`;
let ctx: AdvCtx | null = null;
const jwt = new JWTService();
const token = (userId: string) => `Bearer ${jwt.generateAccessToken({ userId, email: `${userId}@adv.test` })}`;
let session = "";

beforeAll(async () => {
  if (await dbReachable()) ctx = await seedAdversarialFixtures(RUN);
  if (ctx) session = token(ctx.customerA.id);
}, 60_000);
afterAll(async () => {
  if (ctx) await cleanupAdversarialFixtures(RUN);
}, 60_000);

function post(path: string, key: string, body: unknown, auth = session) {
  return app.handle(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { authorization: auth, "content-type": "application/json", "idempotency-key": key, "x-forwarded-for": "10.77.0.9" },
      body: JSON.stringify(body),
    }),
  );
}
const address = (line1: string) => ({
  label: "Other",
  addressLine1: line1,
  city: "Noida",
  state: "Uttar Pradesh",
  zipCode: "201301",
  latitude: 28.62,
  longitude: 77.37,
});
type Json = { code?: string; data: { address: { id: string } } };
const json = async (r: Response) => (await r.json()) as Json;
// Address lines are stored encrypted, so rows are counted per customer, not by their text.
const addresses = () => prisma.address.count({ where: { userId: ctx!.customerA.id } });

describe("Idempotency-Key reuse", () => {
  it("control: the same request replayed with the same key runs once and replays the original outcome", async () => {
    if (!ctx) return;
    const key = `${RUN}-same-0123456789`;
    const before = await addresses();
    const a = await post("/api/users/addresses", key, address(`${RUN} same street`));
    const b = await post("/api/users/addresses", key, address(`${RUN} same street`));
    // Status AND code in one value, so a refusal says which one it was (e.g. IDEMPOTENCY_IN_PROGRESS
    // vs IDEMPOTENCY_KEY_REUSED) — the full-suite-only 409 on the first request was undiagnosable.
    const codeOf = async (r: Response) => (r.status === 201 ? undefined : ((await r.clone().json()) as { code?: string }).code);
    expect({ status: a.status, code: await codeOf(a) }).toEqual({ status: 201, code: undefined });
    expect(b.status).toBe(201);
    expect(b.headers.get("idempotent-replay")).toBe("true");
    expect((await json(b)).data.address.id).toBe((await json(a)).data.address.id);
    expect(await addresses()).toBe(before + 1);
  });

  it("a key reused with a different body is refused — the second request is not reported as a success it never had", async () => {
    if (!ctx) return;
    const key = `${RUN}-body-0123456789`;
    const before = await addresses();
    const a = await post("/api/users/addresses", key, address(`${RUN} first street`));
    expect(a.status).toBe(201);
    const b = await post("/api/users/addresses", key, address(`${RUN} second street`));
    expect(b.status).toBe(409);
    expect((await json(b)).code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(b.headers.get("idempotent-replay")).toBeNull();
    expect(await addresses()).toBe(before + 1);
  });

  it("a key reused on a different endpoint is refused rather than answered with another operation's response", async () => {
    if (!ctx) return;
    const key = `${RUN}-path-0123456789`;
    const a = await post("/api/users/addresses", key, address(`${RUN} path street`));
    expect(a.status).toBe(201);
    const id = (await json(a)).data.address.id as string;
    const b = await post(`/api/users/addresses/${id}/set-default`, key, {});
    expect(b.status).toBe(409);
    expect((await json(b)).code).toBe("IDEMPOTENCY_KEY_REUSED");
    // With its own key the same call runs.
    const c = await post(`/api/users/addresses/${id}/set-default`, `${RUN}-path-fresh-0123`, {});
    expect(c.status).toBeLessThan(300);
    expect((await prisma.address.findUniqueOrThrow({ where: { id } })).isDefault).toBe(true);
  });

  // The offline queue replays after connectivity returns; by then the access token has usually been
  // refreshed. The replay must still find the original outcome.
  it("a replay carrying a refreshed access token for the same customer is a replay, not a second execution", async () => {
    if (!ctx) return;
    const key = `${RUN}-rotate-0123456789`;
    const before = await addresses();
    const a = await post("/api/users/addresses", key, address(`${RUN} rotate street`), token(ctx.customerA.id));
    await new Promise((r) => setTimeout(r, 1100)); // a new iat, so a genuinely different token
    const b = await post("/api/users/addresses", key, address(`${RUN} rotate street`), token(ctx.customerA.id));
    expect(a.status).toBe(201);
    expect(b.headers.get("idempotent-replay")).toBe("true");
    expect(await addresses()).toBe(before + 1);
  });

  it("another customer using the same key is never served the first customer's response", async () => {
    if (!ctx) return;
    const key = `${RUN}-other-0123456789`;
    const a = await post("/api/users/addresses", key, address(`${RUN} mine street`));
    const b = await post("/api/users/addresses", key, address(`${RUN} mine street`), token(ctx.customerB.id));
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.headers.get("idempotent-replay")).toBeNull();
    expect((await json(b)).data.address.id).not.toBe((await json(a)).data.address.id);
  });

  it("key order in the JSON body does not count as a different request", async () => {
    if (!ctx) return;
    const key = `${RUN}-order-0123456789`;
    const before = await addresses();
    const body = address(`${RUN} order street`);
    const reordered = Object.fromEntries(Object.entries(body).reverse());
    const a = await post("/api/users/addresses", key, body);
    const b = await post("/api/users/addresses", key, reordered);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.headers.get("idempotent-replay")).toBe("true");
    expect(await addresses()).toBe(before + 1);
  });

  // The middleware must never consume a body a route reads raw: webhook signatures are computed over
  // the exact bytes. Referencing Elysia's `body` in the global hook broke every webhook with 500.
  it("a raw-body webhook still reads its body — with and without an Idempotency-Key", async () => {
    for (const key of [null, `${RUN}-webhook-0123456789`]) {
      const res = await app.handle(
        new Request("http://localhost/api/payments/webhook", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-razorpay-signature": "0".repeat(64),
            ...(key ? { "idempotency-key": key } : {}),
          },
          body: JSON.stringify({ event: "payment.captured", payload: {} }),
        }),
      );
      expect(res.status).toBeLessThan(500);
    }
  });
});
