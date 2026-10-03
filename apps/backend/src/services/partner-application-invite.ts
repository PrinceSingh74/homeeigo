import jsonwebtoken from "jsonwebtoken";
import { JWT_CONFIG, JWT_SECRETS } from "./jwt.service";

const INVITE_TTL_SECONDS = 14 * 24 * 60 * 60;

export type PartnerLeadInvite = {
  type: "partner_lead_invite";
  leadId: string;
};

export function issuePartnerLeadInvite(leadId: string): string {
  const now = Math.floor(Date.now() / 1000);
  return jsonwebtoken.sign(
    {
      type: "partner_lead_invite",
      leadId,
      iat: now,
      exp: now + INVITE_TTL_SECONDS,
    },
    JWT_SECRETS.ACCESS,
    { algorithm: JWT_CONFIG.ALGORITHM },
  );
}

export function verifyPartnerLeadInvite(token: string): PartnerLeadInvite {
  try {
    const decoded = jsonwebtoken.verify(token, JWT_SECRETS.ACCESS, {
      algorithms: [JWT_CONFIG.ALGORITHM],
    }) as { type?: string; leadId?: string };
    if (decoded.type !== "partner_lead_invite" || !decoded.leadId) {
      throw new Error("VALIDATION:Invalid application invite");
    }
    return { type: "partner_lead_invite", leadId: decoded.leadId };
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("VALIDATION:")) throw err;
    throw new Error("VALIDATION:Application invite is invalid or expired", { cause: err });
  }
}

export function partnerWebOrigin(): string {
  return (process.env.PARTNER_WEB_URL ?? "http://localhost:3002").replace(/\/$/, "");
}

const TERMINAL_INVITE_STATUSES = ["REJECTED", "DUPLICATE", "INVALID", "WITHDRAWN", "ACTIVATED"];

export function assertLeadInviteUsable(lead: {
  status: string;
  providerId?: string | null;
  userId?: string | null;
  mergedIntoLeadId?: string | null;
}, currentUserId?: string | null): void {
  if (TERMINAL_INVITE_STATUSES.includes(lead.status) || lead.mergedIntoLeadId) {
    throw new Error("VALIDATION:This invite is no longer valid");
  }
  if (lead.userId && currentUserId && lead.userId !== currentUserId) {
    throw new Error("CONFLICT:This invite is already linked to another application");
  }
}
