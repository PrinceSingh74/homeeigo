/**
 * A signed webhook body replayed with a different x-razorpay-event-id is still a duplicate (2026-10-01).
 *
 * The dedup key used to be the event-id HEADER, which is not covered by the signature: anyone holding
 * one captured, validly signed body could replay it under a fresh header value and it was processed
 * again. The key is now the hash of the signed body. Signature checking itself is covered elsewhere;
 * here it is stubbed to "valid" so the test isolates the dedup decision.
 */
import "../load-env";
import { afterAll, describe, expect, spyOn, test } from "bun:test";
import crypto from "crypto";
import app from "../index";
import prisma from "../lib/prisma";
import { razorpayService } from "../services/razorpay.service";

const body = JSON.stringify({
  entity: "event",
  event: "replay.probe",
  created_at: Date.now(),
  payload: { probe: crypto.randomUUID() },
});
const key = crypto.createHash("sha256").update(body).digest("hex");

afterAll(async () => {
  await prisma.webhookEventDedup.deleteMany({ where: { eventId: key } });
});

async function deliver(eventIdHeader: string) {
  const res = await app.handle(
    new Request("http://localhost/api/payments/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-razorpay-signature": "f".repeat(64),
        "x-razorpay-event-id": eventIdHeader,
      },
      body,
    }),
  );
  return { status: res.status, json: (await res.json()) as { reason?: string; ignored?: boolean } };
}

describe("webhook dedup", () => {
  test("the same signed body under a new event-id header is ignored as a duplicate", async () => {
    // Bun's spyOn cannot wrap accessors yet: shadow the prototype getter on the instance instead.
    Object.defineProperty(razorpayService, "isWebhookConfigured", { get: () => true, configurable: true });
    const configured = { mockRestore: () => delete (razorpayService as { isWebhookConfigured?: boolean }).isWebhookConfigured };
    const verified = spyOn(razorpayService, "verifyWebhookSignature").mockReturnValue(true);
    try {
      const first = await deliver(`evt_${crypto.randomUUID()}`);
      expect(first.status).toBe(200);
      expect(first.json.reason).not.toBe("DUPLICATE_EVENT");

      const replay = await deliver(`evt_${crypto.randomUUID()}`);
      expect(replay.status).toBe(200);
      expect(replay.json.reason).toBe("DUPLICATE_EVENT");
    } finally {
      configured.mockRestore();
      verified.mockRestore();
    }
  });
});
