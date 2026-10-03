import prisma from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { shadowEvidenceSource } from "../../notifications/governance/shadow-evidence";

/**
 * Whether a business automation has been reviewed and may act for real.
 *
 * Deliberately not Phase-5's approval machinery. That binds a tool, a requester and an arguments
 * hash and is consumed once for a single execution; this is a standing fact about a workflow
 * version. Sharing them would let a business certification be spent like a financial approval, and
 * would make "who approved this refund" and "who signed off this automation" the same question when
 * they are emphatically not.
 *
 * A certification names a person. `certifiedBy` is where responsibility lands, so a service account
 * belongs there only if a human genuinely delegated it — which is a decision, not a default.
 */

/**
 * The authorization a certification cannot be created without.
 *
 * `certifiedBy` used to be the whole of it — a free string, validated by nothing. The boot path
 * passed `"system:partner-acquisition"` and nine workflows became LIVE-certified with no human
 * anywhere in the chain. A string cannot be an authorization, because a string is exactly what code
 * can supply about itself.
 *
 * `adminId` is resolved against `users` at write time and must carry the ADMIN role, so the identity
 * on the row is one the platform can vouch for rather than one the caller asserted.
 */
export type CertificationApproval = {
  adminId: string;
  reason: string;
};

export type CertificationInput = {
  automationId: string;
  workflowVersion: number;
  /** Kept for the human-readable record. No longer trusted as authorization on its own. */
  certifiedBy: string;
  /** Required. A certification with no verifiable approver is what this incident was. */
  approvedBy: CertificationApproval;
  riskClass: "LOW" | "MEDIUM" | "HIGH";
  approvedExecutionMode?: "LIVE" | "SHADOW";
  approvalReference?: string;
  shadowEvidenceReference?: string;
  testEvidenceReference?: string;
  knownLimitations?: string;
  /** What the engine could execute when this was signed. See `capability-fingerprint.ts`. */
  capabilityFingerprint?: string;
};

export const CERTIFICATION_REFUSED = {
  NO_APPROVAL: "CERTIFICATION_REQUIRES_ADMIN_APPROVAL",
  NO_REASON: "CERTIFICATION_REQUIRES_REASON",
  UNKNOWN_ADMIN: "CERTIFICATION_APPROVER_NOT_FOUND",
  NOT_ADMIN: "CERTIFICATION_APPROVER_NOT_ADMIN",
  AUDIT_FAILED: "CERTIFICATION_AUDIT_WRITE_FAILED",
} as const;

/** The audited action a certification writes before it exists. */
export const CERTIFICATION_AUDIT_ACTION = "AUTOMATION_CERTIFICATION_APPROVED";

/**
 * How an audit row written by a test run announces itself.
 *
 * The hardened contract requires an approver who actually resolves to an ADMIN, so a suite
 * exercising the successful path has no choice but to borrow a real person's identity — and the
 * audit row it writes lands in the same activity log as a genuine approval. Ten such rows exist,
 * each naming a real admin against a certification that admin never approved. Readable only because
 * the workflow ids are obviously fictional, which is a convention, not a guarantee.
 *
 * The marker is derived from `shadowEvidenceSource()` — the same process-level signal that already
 * separates rehearsal evidence from real observations — and never from anything the caller passes.
 * A request able to declare its own approval a test could launder a real one into looking
 * disposable.
 *
 * It affects the description text and nothing else. Authorization is untouched: a test run still
 * needs a real, resolvable ADMIN, because weakening that to keep the log tidy would trade the thing
 * the log is for against the tidiness of the log.
 */
export const CERTIFICATION_TEST_AUDIT_MARKER = "[TEST RUN]";

/**
 * The audit line for one certification, marked when the process is a test run.
 *
 * Kept separate from `certifyAutomation` so the marking rule can be asserted directly rather than
 * inferred from a row the assertion had to create first.
 */
export function auditDescription(
  input: Pick<CertificationInput, "automationId" | "workflowVersion" | "approvedExecutionMode">,
  reason: string,
): string {
  const prefix = shadowEvidenceSource() === "TEST" ? `${CERTIFICATION_TEST_AUDIT_MARKER} ` : "";
  return `${prefix}${input.automationId} v${input.workflowVersion} → ${input.approvedExecutionMode ?? "SHADOW"} | ${reason}`;
}

/**
 * Record that a version was certified.
 *
 * One row per version, enforced by a unique index rather than by a check-then-insert — a second
 * certification for the same version is a contradiction, not an update, and re-certifying means
 * publishing a new version.
 *
 * ── Authorization, then audit, then the row ─────────────────────────────────
 *
 * That order is load-bearing and mirrors the payment-gate override. The audit entry is written
 * first, so a certification cannot exist that nobody is recorded as having approved. Writing it
 * afterwards would leave a window — and if the audit write failed, a certification would stand with
 * no account of who allowed it, which is precisely the state this whole incident consisted of.
 */
export async function certifyAutomation(input: CertificationInput): Promise<{ created: boolean }> {
  const approval = input.approvedBy;
  if (!approval || !approval.adminId?.trim()) {
    throw new Error(CERTIFICATION_REFUSED.NO_APPROVAL);
  }
  if (!approval.reason?.trim()) {
    throw new Error(CERTIFICATION_REFUSED.NO_REASON);
  }

  /**
   * The approver is resolved, not accepted.
   *
   * A service account cannot pass here: it has no `users` row with the ADMIN role, so a delegation
   * would have to be a real, auditable record naming a human. None exists in this project, and
   * inventing one was explicitly out of scope — so service-account certification is refused.
   */
  const admin = await prisma.user.findUnique({
    where: { id: approval.adminId.trim() },
    select: { id: true, role: true },
  });
  if (!admin) throw new Error(CERTIFICATION_REFUSED.UNKNOWN_ADMIN);
  if (admin.role !== "ADMIN") throw new Error(CERTIFICATION_REFUSED.NOT_ADMIN);

  const existing = await prisma.automationCertification.findUnique({
    where: {
      automationId_workflowVersion: {
        automationId: input.automationId,
        workflowVersion: input.workflowVersion,
      },
    },
    select: { id: true },
  });
  if (existing) return { created: false };

  try {
    await prisma.activityLog.create({
      data: {
        userId: admin.id,
        action: CERTIFICATION_AUDIT_ACTION,
        description: auditDescription(input, approval.reason.trim()),
      },
    });
  } catch (err) {
    logger.error("certification_audit_write_failed", {
      automationId: input.automationId,
      workflowVersion: input.workflowVersion,
      error: err instanceof Error ? err.message : String(err),
    });
    throw new Error(CERTIFICATION_REFUSED.AUDIT_FAILED, { cause: err });
  }

  await prisma.automationCertification.create({
    data: {
      automationId: input.automationId,
      workflowVersion: input.workflowVersion,
      certifiedBy: input.certifiedBy,
      approvedByAdminId: admin.id,
      capabilityFingerprint: input.capabilityFingerprint ?? null,
      riskClass: input.riskClass,
      approvedExecutionMode: input.approvedExecutionMode ?? "SHADOW",
      approvalReference: input.approvalReference ?? null,
      shadowEvidenceReference: input.shadowEvidenceReference ?? null,
      testEvidenceReference: input.testEvidenceReference ?? null,
      knownLimitations: input.knownLimitations ?? null,
    },
  });
  logger.info("automation_certified", {
    automationId: input.automationId,
    workflowVersion: input.workflowVersion,
    riskClass: input.riskClass,
    approvedExecutionMode: input.approvedExecutionMode ?? "SHADOW",
    approvedByAdminId: admin.id,
  });
  return { created: true };
}

/**
 * Withdraw a certification without erasing it.
 *
 * A voided row is the record that someone once claimed this was approved, which is the thing an
 * audit most needs and the thing a delete destroys. The gate treats a voided certification as
 * absent; everything else about it stays readable.
 */
export async function voidCertification(input: {
  automationId: string;
  workflowVersion: number;
  voidedBy: string;
  reason: string;
}): Promise<{ voided: boolean }> {
  const updated = await prisma.automationCertification.updateMany({
    where: {
      automationId: input.automationId,
      workflowVersion: input.workflowVersion,
      voidedAt: null,
    },
    data: { voidedAt: new Date(), voidedBy: input.voidedBy, voidReason: input.reason },
  });
  if (updated.count > 0) {
    logger.warn("automation_certification_voided", {
      automationId: input.automationId,
      workflowVersion: input.workflowVersion,
      reason: input.reason,
    });
  }
  return { voided: updated.count > 0 };
}

export async function getCertification(automationId: string, workflowVersion: number) {
  return prisma.automationCertification.findUnique({
    where: { automationId_workflowVersion: { automationId, workflowVersion } },
  });
}

/**
 * May this version run for real?
 *
 * Three things must all hold, and the row is the one that cannot be faked by editing code: a
 * definition can declare itself CERTIFIED, but it cannot write its own certification into the
 * database. Anything short of all three is refused rather than downgraded to shadow, because
 * silently running a rehearsal when someone asked for the real thing is its own kind of surprise.
 */
export async function assertLiveAllowed(input: {
  automationId: string;
  workflowVersion: number;
  riskClass?: string | null;
  certificationStatus?: string;
  executionMode?: string;
  /**
   * What the engine can execute for this workflow now. Supplied by the caller that holds the
   * definition; when omitted the capability check is skipped, which keeps every existing caller
   * working unchanged while the sync gate — the one that matters — passes it.
   */
  capabilityFingerprint?: string;
}): Promise<void> {
  // Legacy definitions declare no risk class and are not part of this lifecycle at all.
  if (!input.riskClass) return;
  if (input.executionMode !== "LIVE") return;

  if (input.certificationStatus !== "CERTIFIED") {
    throw new Error(
      `Workflow ${input.automationId}.v${input.workflowVersion} declares executionMode LIVE but its ` +
        `certificationStatus is ${input.certificationStatus ?? "DRAFT"} — a business automation reaches ` +
        `LIVE through certification, never by declaring it`,
    );
  }

  const cert = await getCertification(input.automationId, input.workflowVersion);
  if (!cert) {
    throw new Error(
      `Workflow ${input.automationId}.v${input.workflowVersion} is marked CERTIFIED in code but no ` +
        `AutomationCertification row exists — code cannot certify itself`,
    );
  }
  /**
   * A withdrawn certification is not a certification.
   *
   * Checked before the mode, so a voided row that once approved LIVE cannot keep authorising it.
   * The row stays in the table as evidence; the gate simply stops believing it.
   */
  if (cert.voidedAt) {
    throw new Error(
      `Workflow ${input.automationId}.v${input.workflowVersion} has a VOIDED certification ` +
        `(${cert.voidReason ?? "no reason recorded"}) — re-certification is required`,
    );
  }

  if (cert.approvedExecutionMode !== "LIVE") {
    throw new Error(
      `Workflow ${input.automationId}.v${input.workflowVersion} is certified for ` +
        `${cert.approvedExecutionMode}, not LIVE`,
    );
  }

  /**
   * The engine must still be the one that was signed for.
   *
   * A certification approves a workflow *running on a particular engine*. If a step type the
   * workflow uses has since become executable — ESCALATION being the live example — the same
   * version quietly gained powers nobody reviewed. A mismatch fails closed rather than assuming
   * the reviewer would have said yes.
   *
   * A stored fingerprint of null belongs to a row written before this existed. Those are refused
   * too: an unknown capability scope is not a verified one.
   */
  if (input.capabilityFingerprint !== undefined) {
    if (!cert.capabilityFingerprint) {
      throw new Error(
        `Workflow ${input.automationId}.v${input.workflowVersion} was certified before capability ` +
          `fingerprinting — re-certification is required before it may run LIVE`,
      );
    }
    if (cert.capabilityFingerprint !== input.capabilityFingerprint) {
      throw new Error(
        `Workflow ${input.automationId}.v${input.workflowVersion} is CERTIFICATION_STALE: the engine ` +
          `capabilities it was certified against have changed`,
      );
    }
  }
}
