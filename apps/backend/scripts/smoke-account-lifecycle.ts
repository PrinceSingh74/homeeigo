/**
 * Live smoke: register → consent → export (JSON/ZIP) → delete account.
 *
 *   bun --env-file=.env run scripts/smoke-account-lifecycle.ts
 */
import prisma from "../src/lib/prisma";
import { DEFAULT_BASE, printSmokeSummary, smokeReq, type SmokeResult } from "./smoke-lib";

const tag = Date.now().toString(36);
const email = `smoke-${tag}@lifecycle.test`;
const phone = `+9199${String(Math.floor(10_000_000 + Math.random() * 89_999_999))}`;
const password = "Smoke1!Test";

let userId = "";
let accessToken = "";
const results: SmokeResult[] = [];

function record(name: string, pass: boolean, detail = "") {
  results.push({ name, pass, detail });
  const icon = pass ? "✅" : "❌";
  console.log(`${icon} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function authFetch(path: string, init: RequestInit = {}) {
  return fetch(`${DEFAULT_BASE}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });
}

async function cleanup() {
  if (!userId) return;
  try {
    await prisma.consentRecord.deleteMany({ where: { userId } });
    await prisma.activityLog.deleteMany({ where: { userId } });
    await prisma.passwordHistory.deleteMany({ where: { userId } });
    await prisma.oTP.deleteMany({ where: { phoneNumber: phone } });
    await prisma.user.deleteMany({ where: { id: userId } });
  } catch (e) {
    console.warn(`cleanup skipped: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function main() {
  console.log(`\nAccount lifecycle smoke — ${email} / ${phone}\n`);

  const policies = await smokeReq(DEFAULT_BASE, "/api/legal/policies");
  record("GET /api/legal/policies", policies.status === 200 && policies.body.success === true);

  const otpRes = await smokeReq(DEFAULT_BASE, "/api/auth/send-otp", {
    method: "POST",
    body: JSON.stringify({ phoneNumber: phone }),
  });
  const devOtp = (otpRes.body.data as { devOtp?: string } | undefined)?.devOtp;
  record(
    "POST /api/auth/send-otp",
    otpRes.status === 200 && Boolean(devOtp),
    devOtp ? `otp=${devOtp}` : "devOtp missing (need NODE_ENV!=production)",
  );
  if (!devOtp) {
    printSmokeSummary(results, "Account lifecycle");
    process.exit(1);
  }

  const reg = await smokeReq(DEFAULT_BASE, "/api/auth/register", {
    method: "POST",
    body: JSON.stringify({
      email,
      phoneNumber: phone,
      firstName: "Smoke",
      lastName: "Test",
      password,
      agreeToTerms: true,
      otp: devOtp,
      setAuthCookies: false,
    }),
  });
  const regData = reg.body.data as Record<string, unknown> | undefined;
  accessToken = String(regData?.accessToken ?? "");
  const user = regData?.user as { id?: string } | undefined;
  userId = String(user?.id ?? regData?.userId ?? "");
  record(
    "POST /api/auth/register",
    reg.status === 200 && Boolean(accessToken) && Boolean(userId),
    `userId=${userId.slice(0, 8)}`,
  );

  const consents = await prisma.consentRecord.findMany({ where: { userId } });
  const types = new Set(consents.map((c) => c.policyType));
  record(
    "Consent records stored",
    types.has("TERMS") && types.has("PRIVACY"),
    `count=${consents.length}`,
  );

  const exportJson = await authFetch("/api/users/me/export?format=json");
  const jsonBody = await exportJson.json();
  record(
    "GET /api/users/me/export?format=json",
    exportJson.status === 200 && jsonBody?.success === true && jsonBody?.data?.profile,
  );

  const exportZip = await authFetch("/api/users/me/export?format=zip");
  const zipBuf = await exportZip.arrayBuffer();
  const zipBytes = new Uint8Array(zipBuf);
  record(
    "GET /api/users/me/export?format=zip",
    exportZip.status === 200 && zipBytes[0] === 0x50 && zipBytes[1] === 0x4b,
    `bytes=${zipBytes.byteLength}`,
  );

  const del = await authFetch("/api/users/me", {
    method: "DELETE",
    body: JSON.stringify({ confirm: true, reason: "smoke test" }),
  });
  const delBody = await del.json();
  record(
    "DELETE /api/users/me",
    del.status === 200 && delBody?.success === true,
    delBody?.data?.deletionScheduledAt ? "scheduled" : "",
  );

  const userRow = await prisma.user.findUnique({
    where: { id: userId },
    select: { isActive: true, deletionScheduledAt: true },
  });
  record(
    "User deactivated + deletion scheduled",
    userRow?.isActive === false && Boolean(userRow?.deletionScheduledAt),
  );

  const meAfter = await authFetch("/api/users/me");
  record("Auth blocked after deletion", meAfter.status === 401 || meAfter.status === 403, `status=${meAfter.status}`);

  const audit = await prisma.activityLog.findFirst({
    where: { userId, action: "ACCOUNT_DELETION_SCHEDULED" },
    orderBy: { createdAt: "desc" },
  });
  record("Deletion audit log", Boolean(audit));

  const fails = printSmokeSummary(results, "Account lifecycle");
  await cleanup();
  process.exit(fails > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await cleanup();
  process.exit(1);
});
