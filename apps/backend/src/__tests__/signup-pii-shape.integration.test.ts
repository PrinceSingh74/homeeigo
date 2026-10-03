/**
 * Every product signup path must leave the user row in the encrypted shape: ciphertext + lookup
 * hash, plaintext columns NULL.
 *
 * `POST /api/auth/register` and partner registration step 1 pass plaintext `email`/`phoneNumber`
 * to `prisma.user.create`. That is correct ONLY because `lib/prisma-pii-extension` rewrites every
 * `user.create/update/upsert` on the extended client into ciphertext + hash. Nothing else stands
 * between those handlers and a plaintext row, and the extension does not cover `createMany`,
 * `updateMany`, the base client, or raw SQL.
 *
 * Measured on the live database on 2026-09-21: 180 users with a plaintext `phone_number` and no
 * `phone_hash`. None came from these handlers — they came from certification scripts that insert
 * users with raw `INSERT INTO users` or `createMany`, which bypass the extension. This test pins the
 * half that product traffic depends on: remove or narrow the extension and both cases fail.
 *
 * The register handler is driven through `app.handle` so the assertion covers the route, not a
 * helper. Runs against `homigo_test`.
 */
import "../load-env";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import prisma from "../lib/prisma";
import app from "../index";
import { userPiiService } from "../services/user-pii.service";
import { partnerRegistrationService } from "../services/partner-registration.service";
import { dbReachable, fixturePhone } from "./helpers/adversarial-fixtures";
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";

const RUN = `pii-${Date.now().toString(36)}`;
// Unrelated to the e-mail: the strength check refuses a password that resembles the username.
const PASSWORD = "Quartz#Harbor2026!x";
const created: string[] = [];
let dbOk = false;

beforeAll(async () => {
  dbOk = await dbReachable();
  if (!dbOk) return;
  const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  refuseIfNotIsolatedTestDb(db);
});

afterAll(async () => {
  if (!dbOk || created.length === 0) return;
  await prisma.passwordHistory.deleteMany({ where: { userId: { in: created } } });
  await prisma.provider.deleteMany({ where: { userId: { in: created } } });
  await prisma.user.deleteMany({ where: { id: { in: created } } });
});

const shape = (id: string) =>
  prisma.user.findUniqueOrThrow({
    where: { id },
    select: {
      email: true,
      phoneNumber: true,
      emailEncrypted: true,
      emailHash: true,
      phoneEncrypted: true,
      phoneHash: true,
      dataEncryptionStatus: true,
    },
  });

async function expectEncrypted(id: string, email: string, phone: string) {
  const row = await shape(id);
  expect(row.email).toBeNull();
  expect(row.phoneNumber).toBeNull();
  expect(row.emailEncrypted).toBeTruthy();
  expect(row.phoneEncrypted).toBeTruthy();
  expect(row.phoneHash).toBe(userPiiService.hashPhone(phone));
  expect(row.emailHash).toBeTruthy();
  expect(row.dataEncryptionStatus).toBe("ENCRYPTED");
  // The hash is what lookups use; both must resolve without the plaintext fallback having anything to match.
  expect((await userPiiService.findByPhone(phone))?.id).toBe(id);
  expect((await userPiiService.findByEmail(email))?.id).toBe(id);
}

describe("signup leaves PII encrypted + hashed, never plaintext", () => {
  test("POST /api/auth/register", async () => {
    if (!dbOk) return;
    const email = `${RUN}-reg@homigo.test`;
    const phone = fixturePhone(RUN, 1);
    const res = await app.handle(
      new Request("http://localhost/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email,
          phoneNumber: phone,
          firstName: "Pii",
          lastName: "Shape",
          password: PASSWORD,
          confirmPassword: PASSWORD,
          agreeToTerms: true,
        }),
      }),
    );
    const body = (await res.json()) as {
      success: boolean;
      data?: { userId?: string; user?: { id: string } };
      code?: string;
      error?: string;
    };
    expect(res.status, JSON.stringify({ code: body.code, error: body.error })).toBe(201);
    // OTP-first registration answers `data.userId`; direct registration answers `data.user.id`.
    const id = (body.data?.userId ?? body.data?.user?.id)!;
    expect(id).toBeTruthy();
    created.push(id);
    await expectEncrypted(id, email, phone);
  });

  test("partner registration step 1", async () => {
    if (!dbOk) return;
    const email = `${RUN}-partner@homigo.test`;
    const phone = fixturePhone(RUN, 2);
    const out = await partnerRegistrationService.step1({
      email,
      phoneNumber: phone,
      firstName: "Pii",
      lastName: "Partner",
      password: PASSWORD,
      confirmPassword: PASSWORD,
    });
    created.push(out.userId);
    await expectEncrypted(out.userId, email, phone);
  });
});
