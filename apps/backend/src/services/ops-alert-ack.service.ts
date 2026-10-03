import prisma from "../lib/prisma";
import { AuditLogService } from "./audit-log.service";

/** How long an acknowledgement silences a still-present condition before it alerts again. */
export const OPS_ALERT_ACK_TTL_MS = Number(process.env.OPS_ALERT_ACK_TTL_MS || 12 * 3_600_000);
const KEY_RE = /^[A-Z0-9_]{1,64}:[A-Za-z0-9_-]{0,64}:[A-Za-z0-9_-]{0,64}$/;

export type OpsAlertAck = { alertKey: string; acknowledgedBy: string; acknowledgedAt: string; expiresAt: string };

/**
 * Shared, audited acknowledgement of live ops alerts — what every admin sees, not one browser's
 * localStorage. Keys are the ops-map alert identity "<TYPE>:<bookingId>:<providerId>".
 */
export const opsAlertAckService = {
  isValidKey: (k: string) => KEY_RE.test(k),

  async active(now = new Date()): Promise<OpsAlertAck[]> {
    const rows = await prisma.$queryRaw<
      Array<{ alert_key: string; acknowledged_by: string; acknowledged_at: Date; expires_at: Date }>
    >`SELECT alert_key, acknowledged_by, acknowledged_at, expires_at
      FROM ops_alert_acknowledgements WHERE expires_at > ${now} ORDER BY acknowledged_at DESC LIMIT 1000`;
    return rows.map((r) => ({
      alertKey: r.alert_key,
      acknowledgedBy: r.acknowledged_by,
      acknowledgedAt: r.acknowledged_at.toISOString(),
      expiresAt: r.expires_at.toISOString(),
    }));
  },

  async acknowledge(keys: string[], adminUserId: string, now = new Date()): Promise<{ acknowledged: number; rejected: string[] }> {
    const unique = [...new Set(keys)];
    const valid = unique.filter((k) => KEY_RE.test(k));
    const rejected = unique.filter((k) => !KEY_RE.test(k));
    const expires = new Date(now.getTime() + OPS_ALERT_ACK_TTL_MS);
    for (const key of valid) {
      await prisma.$executeRaw`
        INSERT INTO ops_alert_acknowledgements (alert_key, acknowledged_by, acknowledged_at, expires_at)
        VALUES (${key}, ${adminUserId}, ${now}, ${expires})
        ON CONFLICT (alert_key) DO UPDATE
          SET acknowledged_by = EXCLUDED.acknowledged_by,
              acknowledged_at = EXCLUDED.acknowledged_at,
              expires_at = EXCLUDED.expires_at`;
    }
    if (valid.length > 0) {
      void AuditLogService.success("OPS_ALERT_ACKNOWLEDGED", {
        userId: adminUserId,
        details: { keys: valid.slice(0, 50), count: valid.length, expiresAt: expires.toISOString() },
      });
    }
    // Housekeeping: expired acknowledgements carry no meaning.
    await prisma.$executeRaw`DELETE FROM ops_alert_acknowledgements WHERE expires_at < ${new Date(now.getTime() - 86_400_000)}`;
    return { acknowledged: valid.length, rejected };
  },
};
