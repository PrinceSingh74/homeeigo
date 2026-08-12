/**
 * Live adversarial security audit — fires real HTTP attacks at the running server
 * and asserts each is rejected. Evidence-only: every check prints PASS/FAIL with the
 * observed HTTP status. Exit 0 only if zero bypasses.
 *
 *   bun run scripts/security-adversarial-audit.ts
 */
const BASE = process.env.AUDIT_BASE_URL || "http://localhost:3000";

type Check = { name: string; category: string; pass: boolean; detail: string };
const results: Check[] = [];

function record(name: string, category: string, pass: boolean, detail: string) {
  results.push({ name, category, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} [${category}] ${name} — ${detail}`);
}

async function req(path: string, init?: RequestInit): Promise<{ status: number; body: string }> {
  const res = await fetch(`${BASE}${path}`, init);
  const body = await res.text();
  return { status: res.status, body };
}

async function main() {
  // ---- 1. JWT: forged / malformed / none tokens must be rejected on protected routes
  {
    const none = await req("/api/payments/history", { headers: { Authorization: "Bearer " } });
    record("reject empty bearer", "JWT", none.status === 401, `status=${none.status}`);

    const forged = await req("/api/payments/history", {
      headers: { Authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhdHRhY2tlciIsInJvbGUiOiJBRE1JTiJ9.forgedsig" },
    });
    record("reject forged JWT", "JWT", forged.status === 401, `status=${forged.status}`);

    const alg = await req("/api/payments/history", {
      headers: { Authorization: "Bearer eyJhbGciOiJub25lIn0.eyJzdWIiOiJhdHRhY2tlciJ9." },
    });
    record("reject alg=none JWT", "JWT", alg.status === 401, `status=${alg.status}`);
  }

  // ---- 2. RBAC / privilege escalation: admin route without admin token
  {
    const admin = await req("/api/admin/users");
    record("admin route requires auth", "RBAC", admin.status === 401 || admin.status === 403, `status=${admin.status}`);

    const adminForged = await req("/api/admin/users", {
      headers: { Authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiQURNSU4ifQ.x" },
    });
    record("admin route rejects forged admin", "PrivEsc", adminForged.status === 401 || adminForged.status === 403, `status=${adminForged.status}`);
  }

  // ---- 3. IDOR: accessing another user's resource without auth
  {
    const idor = await req("/api/bookings/clx000000000000000000000");
    record("booking detail requires auth (IDOR)", "IDOR", idor.status === 401 || idor.status === 403, `status=${idor.status}`);
  }

  // ---- 4. Webhook signature: tampered + replayed must be 401
  {
    const bad = await req("/api/payments/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-razorpay-signature": "deadbeef-not-valid" },
      body: JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_evil", amount: 100000 } } } }),
    });
    record("reject tampered webhook signature", "WebhookReplay", bad.status === 401, `status=${bad.status}`);

    const noSig = await req("/api/payments/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "payment.captured", payload: {} }),
    });
    record("reject unsigned webhook", "WebhookReplay", noSig.status === 401, `status=${noSig.status}`);
  }

  // ---- 5. SQL injection in query params — must not 500 or leak
  {
    const sqli = await req(`/api/services?category=${encodeURIComponent("' OR 1=1;--")}`);
    record("SQLi in category param neutralized", "SQLInjection", sqli.status < 500, `status=${sqli.status}`);

    const sqli2 = await req(`/api/services?limit=${encodeURIComponent("1;DROP TABLE services;--")}`);
    record("SQLi in limit param neutralized", "SQLInjection", sqli2.status < 500, `status=${sqli2.status}`);
  }

  // ---- 6. Mass assignment: try to set role/isAdmin on a public endpoint
  {
    const ma = await req("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `ma${Date.now()}@x.test`,
        password: "Password123!",
        firstName: "M",
        lastName: "A",
        phoneNumber: `+91${String(Date.now()).slice(-10)}`,
        role: "ADMIN",
        isAdmin: true,
        walletBalance: 999999,
      }),
    });
    // Either rejected, or accepted but role/balance ignored — verify no 500 and not granted.
    const grantedAdmin = ma.body.includes('"role":"ADMIN"') || ma.body.includes('"isAdmin":true');
    const grantedMoney = ma.body.includes("999999");
    record("mass assignment ignored (role/balance)", "MassAssignment", ma.status < 500 && !grantedAdmin && !grantedMoney, `status=${ma.status}, grantedAdmin=${grantedAdmin}, grantedMoney=${grantedMoney}`);
  }

  // ---- 8. SSRF: profile/avatar URL pointing at internal metadata must be rejected/ignored
  {
    const ssrf = await req("/api/users/me", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profileImage: "http://169.254.169.254/latest/meta-data/" }),
    });
    // Unauthenticated → must be 401 (no SSRF fetch happens without auth).
    record("SSRF avatar requires auth (no unauth fetch)", "SSRF", ssrf.status === 401, `status=${ssrf.status}`);
  }

  // ---- 9. Payment tampering: create-order without auth must be rejected
  {
    const tamper = await req("/api/payments/create-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookingId: "x", amount: 1 }),
    });
    record("create-order requires auth (amount tamper)", "PaymentTampering", tamper.status === 401, `status=${tamper.status}`);
  }

  // ---- 10. Gift card / coupon abuse: redeem without auth must be rejected
  {
    const gc = await req("/api/giftcards/redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "FREE" }),
    });
    record("gift card redeem requires auth", "GiftCardAbuse", gc.status === 401, `status=${gc.status}`);
  }

  // ---- 11. Rate limiting LAST (it deliberately trips the limiter, polluting later checks)
  {
    let throttled = false;
    let last = 0;
    for (let i = 0; i < 40; i++) {
      const r = await req("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "ratelimit@x.test", password: "wrong" }),
      });
      last = r.status;
      if (r.status === 429) { throttled = true; break; }
    }
    record("login brute-force throttled", "RateLimiting", throttled, throttled ? "got 429" : `no 429 after 40 attempts (last=${last})`);
  }

  const failed = results.filter((r) => !r.pass);
  console.log("\n================ SECURITY AUDIT SUMMARY ================");
  console.log(`total checks: ${results.length} | passed: ${results.length - failed.length} | failed: ${failed.length}`);
  const byCat = [...new Set(results.map((r) => r.category))];
  for (const c of byCat) {
    const cr = results.filter((r) => r.category === c);
    console.log(`  ${c}: ${cr.filter((r) => r.pass).length}/${cr.length}`);
  }
  console.log(failed.length === 0 ? "VERDICT: NO BYPASS REPRODUCED" : `VERDICT: ${failed.length} BYPASS(ES) — ${failed.map((f) => f.name).join("; ")}`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main();
