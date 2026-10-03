/**
 * Rating photos (2026-10-01): content-checked uploads through object storage, URLs from a trusted
 * origin (never the Host header on a deployed host), and ratings that may only reference the author's
 * own uploaded photos.
 */
import "../load-env";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import app from "../index";
import { canonicalOwnRatingPhotos, ratingPhotoUrl, RATING_PHOTO_NAMESPACE } from "../lib/rating-photos";
import { objectStorageService } from "../services/object-storage.service";
import { bearer, cleanupAdversarialFixtures, dbReachable, seedAdversarialFixtures, type AdvCtx } from "./helpers/adversarial-fixtures";

const RUN_ID = `rating-photos-${Date.now().toString(36)}`;
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a2e5b5a00000000049454e44ae426082",
  "hex",
);
const ENV_KEYS = ["PUBLIC_API_ORIGIN", "APP_ENV", "NODE_ENV"] as const;
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
const uploaded: string[] = [];
let ctx: AdvCtx;

beforeAll(async () => {
  if (!(await dbReachable())) throw new Error("homigo_test is not reachable");
  ctx = await seedAdversarialFixtures(RUN_ID);
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});
afterAll(async () => {
  for (const name of uploaded) await objectStorageService.deleteObject(RATING_PHOTO_NAMESPACE, name).catch(() => undefined);
  if (ctx) await cleanupAdversarialFixtures(RUN_ID);
});

async function upload(token: string, bytes: Buffer, type: string, host = "localhost:3000") {
  const form = new FormData();
  form.append("file", new File([bytes], "photo", { type }));
  const res = await app.handle(
    new Request("http://localhost/api/uploads/ratings", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, host },
      body: form,
    }),
  );
  const json = (await res.json()) as { data?: { url?: string }; code?: string };
  const url = json.data?.url;
  if (url) uploaded.push(url.split("/").pop()!);
  return { status: res.status, url, code: json.code };
}

describe("rating photo upload", () => {
  test("the file's bytes decide the type: HTML declared as image/png is refused", async () => {
    const r = await upload(bearer(ctx.customerA), Buffer.from("<html><script>alert(1)</script></html>"), "image/png");
    expect(r).toMatchObject({ status: 400, code: "VALIDATION_ERROR" });
  });

  test("a real PNG is stored and served back with an image content type", async () => {
    const r = await upload(bearer(ctx.customerA), PNG, "image/png");
    expect(r.status).toBe(201);
    const path = new URL(r.url!, "http://x").pathname;
    const served = await app.handle(new Request(`http://localhost${path}`));
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await served.arrayBuffer()).equals(PNG)).toBe(true);
  });

  test("the returned URL comes from PUBLIC_API_ORIGIN, not the request's Host header", async () => {
    process.env.PUBLIC_API_ORIGIN = "https://api.example.com";
    const r = await upload(bearer(ctx.customerA), PNG, "image/png", "evil.example");
    expect(r.url!.startsWith("https://api.example.com/uploads/ratings/")).toBe(true);
  });

  test("a deployed host without a configured origin never echoes the Host header", () => {
    delete process.env.PUBLIC_API_ORIGIN;
    process.env.APP_ENV = "staging";
    const req = new Request("http://localhost/x", { headers: { host: "evil.example", "x-forwarded-proto": "https" } });
    expect(ratingPhotoUrl("abc", req)).toBe("/uploads/ratings/abc");
  });
});

describe("photos a rating may reference", () => {
  test("only the author's own uploaded photos, rebuilt from the trusted origin", async () => {
    const mine = await upload(bearer(ctx.customerA), PNG, "image/png");
    const theirs = await upload(bearer(ctx.customerB), PNG, "image/png");
    const myName = mine.url!.split("/").pop()!;
    process.env.PUBLIC_API_ORIGIN = "https://api.example.com";

    expect(await canonicalOwnRatingPhotos(ctx.customerA.id, [`https://evil.example/uploads/ratings/${myName}`])).toEqual([
      `https://api.example.com/uploads/ratings/${myName}`,
    ]);
    expect(await canonicalOwnRatingPhotos(ctx.customerA.id, ["https://tracker.example/pixel.gif"])).toBeNull();
    expect(await canonicalOwnRatingPhotos(ctx.customerA.id, [theirs.url!])).toBeNull();
    const ghost = `${ctx.customerA.id.toLowerCase()}-1790000000000-deadbeef.png`;
    expect(await canonicalOwnRatingPhotos(ctx.customerA.id, [`/uploads/ratings/${ghost}`])).toBeNull();
    expect(await canonicalOwnRatingPhotos(ctx.customerA.id, Array.from({ length: 7 }, () => mine.url!))).toBeNull();
    expect(await canonicalOwnRatingPhotos(ctx.customerA.id, [])).toEqual([]);
  });
});
