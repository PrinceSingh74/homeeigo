import prisma from "../lib/prisma";

/**
 * Who receives a scheduled executive report.
 *
 * ── The one rule this file exists to enforce ───────────────────────────────────
 *
 * A recipient is **derived**, never supplied. Nothing in a `ScheduledJob` payload, an HTTP body, or
 * a caller's argument list can name who gets a report. The list comes from the admin role table:
 * active administrators whose role actually holds the permission the report's own route requires.
 *
 * That is not a stylistic preference. A report is a bundle of finance, fraud and forecast internals;
 * a payload-supplied `recipientId` would make "send Admin A's report to Admin B" a single field
 * away, and a scheduled job's payload is exactly the kind of row that gets edited by hand during an
 * incident. Deriving it means the worst a forged payload can do is name a period.
 *
 * ── Why this permission ────────────────────────────────────────────────────────
 *
 * `ANALYTICS` / `READ` is not invented here. It is the resource and action the existing route table
 * already assigns to every executive-intelligence read — `/api/admin/finance/intelligence`,
 * `/api/admin/analytics`, `/api/admin/risk/intelligence` and a dozen more. A report that pushes the
 * same content to someone must not be reachable by anyone who could not have opened it themselves.
 *
 * SUPER_ADMIN is included because `rbacService.hasPermission` returns true unconditionally for that
 * role: excluding it here would mean the report skipped the only people guaranteed to be able to
 * read it.
 */

/** The permission a recipient must hold, quoted from the existing admin route table. */
export const REPORT_VIEW_RESOURCE = "ANALYTICS" as const;
export const REPORT_VIEW_ACTION = "READ" as const;

export type ReportRecipient = {
  /** A `User.id`, because that is what the notification router resolves. Never a contact detail. */
  userId: string;
  adminId: string;
  roleName: string;
  /** How this recipient qualified, so an audit row can say why they were included. */
  basis: "ROLE_PERMISSION" | "SUPER_ADMIN";
};

/**
 * Resolve the recipient list from the database.
 *
 * Deliberately takes no arguments. There is no filter, no override and no "also send to" parameter,
 * because every one of those would be a way to widen the audience from the outside.
 */
export async function resolveReportRecipients(): Promise<ReportRecipient[]> {
  const admins = await prisma.adminUser.findMany({
    where: { isActive: true, revokedAt: null },
    select: {
      id: true,
      userId: true,
      role: { select: { name: true, permissions: { select: { resource: true, action: true } } } },
      user: { select: { isActive: true, isBanned: true } },
    },
  });

  const out: ReportRecipient[] = [];
  for (const a of admins) {
    // An account that cannot log in must not receive a report about the platform's internals.
    if (!a.user.isActive || a.user.isBanned) continue;

    if (a.role.name === "SUPER_ADMIN") {
      out.push({ userId: a.userId, adminId: a.id, roleName: a.role.name, basis: "SUPER_ADMIN" });
      continue;
    }
    const permitted = a.role.permissions.some(
      (p) => p.resource === REPORT_VIEW_RESOURCE && p.action === REPORT_VIEW_ACTION,
    );
    if (permitted) {
      out.push({ userId: a.userId, adminId: a.id, roleName: a.role.name, basis: "ROLE_PERMISSION" });
    }
  }
  return out;
}
