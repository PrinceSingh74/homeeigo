import { Elysia } from "elysia";
import crypto from "crypto";
import { emailDeliveryService } from "../services/email-delivery.service";
import { webhookDedupService } from "../services/webhook-dedup.service";
import { incCounter } from "../lib/metrics";
import { logger } from "../lib/logger";

/**
 * Resend delivery webhooks (bounce / complaint → suppression).
 *
 * Resend signs with Svix: headers `svix-id`, `svix-timestamp`, `svix-signature` (one or more
 * `v1,<base64>` entries), the signed content is `${id}.${timestamp}.${rawBody}`, and the key is the
 * base64 part of a `whsec_…` secret. The previous verifier HMAC'd the raw body alone with a hex
 * digest and compared it to the whole header — so no genuine Resend event ever verified (bounces
 * were never suppressed), while the secret fell back to RESEND_API_KEY, a credential every
 * deployment has, making forged suppression events cheap for anyone holding it.
 *
 * Now: dedicated secret only (no API-key fallback), Svix-compatible verification with a replay
 * window, body cap, and the same claim-based dedup the Razorpay webhook uses.
 */
const TOLERANCE_SEC = 5 * 60;
const MAX_BODY_BYTES = 64 * 1024;

function webhookSecretBytes(): Buffer | null {
  const raw = process.env.RESEND_WEBHOOK_SECRET?.trim();
  if (!raw) return null;
  const b64 = raw.startsWith("whsec_") ? raw.slice("whsec_".length) : raw;
  try {
    return Buffer.from(b64, "base64");
  } catch {
    return null;
  }
}

export type SvixHeaders = { id: string | null; timestamp: string | null; signature: string | null };

export function verifySvixSignature(
  rawBody: string,
  headers: SvixHeaders,
  secret: Buffer | null,
  nowSec = Math.floor(Date.now() / 1000),
): { ok: true } | { ok: false; reason: string } {
  if (!secret || secret.length === 0) return { ok: false, reason: "secret_not_configured" };
  if (!headers.id || !headers.timestamp || !headers.signature) return { ok: false, reason: "missing_headers" };
  const ts = Number(headers.timestamp);
  if (!Number.isFinite(ts)) return { ok: false, reason: "bad_timestamp" };
  if (Math.abs(nowSec - ts) > TOLERANCE_SEC) return { ok: false, reason: "timestamp_out_of_window" };

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${headers.id}.${headers.timestamp}.${rawBody}`)
    .digest();
  // The header may carry several space-separated versions/keys during a secret rotation.
  for (const entry of headers.signature.split(" ")) {
    const [version, sig] = entry.split(",", 2);
    if (version !== "v1" || !sig) continue;
    let candidate: Buffer;
    try {
      candidate = Buffer.from(sig, "base64");
    } catch {
      continue;
    }
    if (candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected)) return { ok: true };
  }
  return { ok: false, reason: "bad_signature" };
}

export const webhooksRoutes = new Elysia({ prefix: "/api/webhooks" }).post("/resend", async ({ request, set }) => {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) {
    incCounter("email_webhook_rejected_total", { reason: "body_too_large" });
    set.status = 413;
    return { success: false, error: "Payload too large" };
  }
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody) > MAX_BODY_BYTES) {
    incCounter("email_webhook_rejected_total", { reason: "body_too_large" });
    set.status = 413;
    return { success: false, error: "Payload too large" };
  }

  const verdict = verifySvixSignature(
    rawBody,
    {
      id: request.headers.get("svix-id"),
      timestamp: request.headers.get("svix-timestamp"),
      signature: request.headers.get("svix-signature"),
    },
    webhookSecretBytes(),
  );
  if (!verdict.ok) {
    incCounter("email_webhook_rejected_total", { reason: verdict.reason });
    if (verdict.reason === "secret_not_configured") {
      logger.error("resend_webhook_secret_missing", { hint: "set RESEND_WEBHOOK_SECRET (whsec_…) from the Resend dashboard" });
    }
    set.status = 401;
    return { success: false, error: "Invalid signature" };
  }

  let payload: { type?: string; data?: { email?: string; reason?: string } };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    set.status = 400;
    return { success: false, error: "Invalid JSON" };
  }
  const eventType = typeof payload.type === "string" ? payload.type : "unknown";
  const eventId = `resend:${request.headers.get("svix-id")}`;

  const begin = await webhookDedupService.beginProcessing(eventId, eventType, request.headers.get("svix-id") ?? undefined);
  if (begin === "SKIP") return { success: true, received: eventType, duplicate: true };

  try {
    const email = payload.data?.email;
    if (eventType.includes("bounce") || eventType.includes("complaint")) {
      if (email) await emailDeliveryService.suppress(email, eventType);
      incCounter("email_bounced_total", { type: eventType });
    }
    await webhookDedupService.markProcessed(eventId);
    return { success: true, received: eventType };
  } catch (err) {
    await webhookDedupService.markFailed(eventId, err instanceof Error ? err.message : String(err));
    set.status = 500;
    return { success: false, error: "Processing failed" };
  }
});
