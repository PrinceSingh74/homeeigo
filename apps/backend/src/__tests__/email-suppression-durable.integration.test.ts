/**
 * Coding-phase gap closure 2026-09-28: bounce suppression lived only in Redis. `suppress()` also wrote
 * a durable `bounce_suppression` / `bounced` email_logs row, but `isSuppressed()` never read it — so
 * with Redis unavailable, restarted or flushed, a bounced address kept being mailed. Reproduced in a
 * process without a Redis connection: after suppress(), the next dispatch called the provider and
 * logged "sent". Redis is optional everywhere else in this codebase; suppression now falls back to
 * the durable row, within the same 90-day window.
 *
 * This runtime has no Redis (REDIS_URL empty), which is exactly the case under test.
 */
import { afterAll, describe, expect, it } from "bun:test";
import prisma from "../lib/prisma";
import { emailDeliveryService } from "../services/email-delivery.service";
import { emailService } from "../services/email.service";

const RUN = `sup-${Date.now().toString(36)}`;
const addr = (tag: string) => `adv-${RUN}-${tag}@adv.test`;

afterAll(async () => {
  await prisma.emailLog.deleteMany({ where: { to: { contains: RUN } } });
});

async function sendCounting(to: string) {
  let calls = 0;
  const original = emailService.send.bind(emailService);
  (emailService as { send: typeof emailService.send }).send = async (args) => {
    calls++;
    return original(args);
  };
  try {
    const r = await emailDeliveryService.dispatchWithRetry({ to, emailType: "booking_confirmation" as never, subject: "cert", html: "<p>cert</p>" });
    return { ...r, calls };
  } finally {
    (emailService as { send: typeof emailService.send }).send = original;
  }
}

describe("bounce suppression without Redis", () => {
  it("a suppressed address is not mailed again — the durable suppression row is honoured", async () => {
    const to = addr("bounced");
    await emailDeliveryService.suppress(to, "hard bounce");
    expect(await emailDeliveryService.isSuppressed(to)).toBe(true);
    const r = await sendCounting(to);
    expect(r.delivered).toBe(false);
    expect(r.calls).toBe(0);
    expect((await prisma.emailLog.findUniqueOrThrow({ where: { id: r.logId } })).status).toBe("suppressed");
  });

  it("suppression is case-insensitive, like the Redis key", async () => {
    const to = addr("mixed");
    await emailDeliveryService.suppress(to.toUpperCase(), "complaint");
    expect(await emailDeliveryService.isSuppressed(to)).toBe(true);
  });

  it("a suppression older than the 90-day window no longer blocks", async () => {
    const to = addr("expired");
    await prisma.emailLog.create({
      data: { to, emailType: "bounce_suppression", subject: "Suppressed: old", status: "bounced", createdAt: new Date(Date.now() - 91 * 86_400_000) },
    });
    expect(await emailDeliveryService.isSuppressed(to)).toBe(false);
  });

  it("control: an address never suppressed is mailed", async () => {
    const r = await sendCounting(addr("clean"));
    expect(r.calls).toBe(1);
    expect(r.delivered).toBe(true); // console provider in a test runtime
  });
});
