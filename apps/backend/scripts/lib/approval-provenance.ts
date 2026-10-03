/**
 * Who approved the Phase 10 content that is live — read from the durable audit record, never from a file.
 *
 * `AuditLogService.record` writes each SERVICE_CONFIG_VERSIONED change to `activity_logs.description`
 * (JSON: action, serviceId, version, reason). The content apply-plan's reason carries
 * "hash <first 16 of the content hash> · approved by <name> (<approvedAt>)". An owner attestation
 * (`scripts/phase10-attest-approval.ts`) appends a PHASE10_CONTENT_APPROVAL_ATTESTED row for the exact
 * service, version and full content hash. Approval FILES are not evidence: a rehearsal file carries the
 * same hashes, and a file can be written after the fact by anyone.
 */
import { isValidApproverName } from "./approver-name";

export const ATTESTATION_ACTION = "PHASE10_CONTENT_APPROVAL_ATTESTED";

export type ProvenanceTarget = { serviceId: string; version: number; contentHash: string };
export type ApprovalProvenance =
  | { kind: "APPROVED" | "ATTESTED"; approver: string }
  | { kind: "PLACEHOLDER"; approver: string }
  | { kind: "UNRECORDED" };

/** "… approved by NAME (2026-…)" → "NAME"; null when the reason names no approver. */
export function approverFromReason(reason: string | null | undefined): string | null {
  if (!reason) return null;
  const m = reason.match(/approved by (.+?)(?: \(\d{4}-\d{2}-\d{2}[^)]*\))?\s*$/);
  return m ? m[1]!.trim() : null;
}

function parse(description: string | null | undefined): Record<string, unknown> | null {
  if (!description) return null;
  try {
    const v = JSON.parse(description) as unknown;
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * `rows` newest first. Provenance binds to the service and the CONTENT HASH, not the version: a later
 * version that changed other keys (the E2 / E applies bumped every live version) leaves the approved
 * content — and who approved it — unchanged. The caller has already proven the live content equals the
 * draft whose hash is `target.contentHash`; `target.version` is informational.
 */
export function classifyApprovalProvenance(rows: Array<{ description: string | null }>, target: ProvenanceTarget): ApprovalProvenance {
  const parsed = rows.map((r) => parse(r.description)).filter((d): d is Record<string, unknown> => d !== null);
  const sameService = (d: Record<string, unknown>) => d.serviceId === target.serviceId;

  const attestation = parsed.find((d) => d.action === ATTESTATION_ACTION && sameService(d) && d.contentHash === target.contentHash && isValidApproverName(d.approvedBy));
  if (attestation) return { kind: "ATTESTED", approver: String(attestation.approvedBy) };

  const apply = parsed.find(
    (d) => d.action === "SERVICE_CONFIG_VERSIONED" && sameService(d) && typeof d.reason === "string" && d.reason.includes(`hash ${target.contentHash.slice(0, 16)}`),
  );
  if (!apply) return { kind: "UNRECORDED" };
  const approver = approverFromReason(apply.reason as string);
  if (approver && isValidApproverName(approver)) return { kind: "APPROVED", approver };
  return { kind: "PLACEHOLDER", approver: approver ?? "(none)" };
}
