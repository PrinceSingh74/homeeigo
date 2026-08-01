import { Elysia, t } from "elysia";
import crypto from "crypto";
import { emailDeliveryService } from "../services/email-delivery.service";
import { incCounter } from "../lib/metrics";

const WEBHOOK_SECRET = process.env.RESEND_WEBHOOK_SECRET || process.env.RESEND_API_KEY || "";

function verifyResendSignature(rawBody: string, signature: string | null): boolean {
  if (!WEBHOOK_SECRET || !signature) return false;
  const expected = crypto.createHmac("sha256", WEBHOOK_SECRET).update(rawBody).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

export const webhooksRoutes = new Elysia({ prefix: "/api/webhooks" }).post(
  "/resend",
  async ({ request, set }) => {
    const rawBody = await request.text();
    const signature = request.headers.get("svix-signature") ?? request.headers.get("x-resend-signature");
    if (!verifyResendSignature(rawBody, signature)) {
      incCounter("email_webhook_rejected_total", { reason: "bad_signature" });
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
    const eventType = payload.type ?? "unknown";
    const email = payload.data?.email;
    if (eventType.includes("bounce") || eventType.includes("complaint")) {
      if (email) {
        await emailDeliveryService.suppress(email, eventType);
      }
      incCounter("email_bounced_total", { type: eventType });
    }
    return { success: true, received: eventType };
  },
);
