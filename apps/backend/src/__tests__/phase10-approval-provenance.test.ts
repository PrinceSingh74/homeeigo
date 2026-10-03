/**
 * Phase 10 content approval provenance — who approved the content that is live?
 *
 * The durable record is the `activity_logs` row `AuditLogService.record` writes for every
 * SERVICE_CONFIG_VERSIONED change (its `enterprise_audit_logs` twin had the reason erased by the
 * old sanitiser). On homigo_db the 25 content applies of 2026-09-29 read
 * "approved by YOUR NAME (2026-09-29T05:24:02.246Z)". Those rows are history and are never edited;
 * provenance is repaired forward by an owner ATTESTATION row for the exact service and content hash.
 * Provenance binds to the CONTENT HASH, not the service version: on live, the E2 / E applies bumped
 * every version after the content apply, while the approved content stayed byte-identical.
 * The classifier below is what the live verifier and the attestation script share (rows newest first).
 */
import { describe, expect, test } from "bun:test";
import { spawnSyncFreshClock } from "./helpers/fresh-loop-clock";
import { join } from "node:path";
import { ATTESTATION_ACTION, approverFromReason, classifyApprovalProvenance } from "../../scripts/lib/approval-provenance";

const target = { serviceId: "cmsvc000000000000000001", version: 7, contentHash: "6d3e09f791a56dfb72044ee38f5b84f5f772e10d4b5935b6c8e25f90994a41ae" };
const applyRow = (approver: string, over: Record<string, unknown> = {}) => ({
  description: JSON.stringify({
    status: "success",
    action: "SERVICE_CONFIG_VERSIONED",
    serviceId: target.serviceId,
    version: target.version,
    reason: `Phase 10 execution/safety/quality content 2026-09-28.draft.2 · deep-cleaning · hash ${target.contentHash.slice(0, 16)} · approved by ${approver} (2026-09-29T05:24:02.246Z)`,
    ...over,
  }),
});
const attestRow = (approvedBy: string, over: Record<string, unknown> = {}) => ({
  description: JSON.stringify({ status: "success", action: ATTESTATION_ACTION, serviceId: target.serviceId, version: target.version, contentHash: target.contentHash, approvedBy, ...over }),
});

describe("approverFromReason", () => {
  test("reads the approver between 'approved by' and the timestamp", () => {
    expect(approverFromReason("… · approved by YOUR NAME (2026-09-29T05:24:02.246Z)")).toBe("YOUR NAME");
    expect(approverFromReason("… · approved by Asha Rao (2026-09-29T05:24:02.246Z)")).toBe("Asha Rao");
    expect(approverFromReason("… · approved by Asha Rao")).toBe("Asha Rao");
  });
  test("a reason without an approver yields null", () => {
    expect(approverFromReason("Age policy: explicit NO_AGE_RESTRICTION v1")).toBeNull();
    expect(approverFromReason(null)).toBeNull();
  });
});

describe("classifyApprovalProvenance", () => {
  test("the live 2026-09-29 shape — applied under a placeholder — is PLACEHOLDER", () => {
    expect(classifyApprovalProvenance([applyRow("YOUR NAME")], target)).toEqual({ kind: "PLACEHOLDER", approver: "YOUR NAME" });
  });
  test("an apply signed by a real name, with the matching hash, is APPROVED", () => {
    expect(classifyApprovalProvenance([applyRow("Asha Rao")], target)).toEqual({ kind: "APPROVED", approver: "Asha Rao" });
  });
  test("an owner attestation for the exact service and content hash repairs a placeholder apply", () => {
    expect(classifyApprovalProvenance([attestRow("Asha Rao"), applyRow("YOUR NAME")], target)).toEqual({ kind: "ATTESTED", approver: "Asha Rao" });
  });
  test("a later version that left the content unchanged keeps the apply's provenance (live: E2 / E bumped every version)", () => {
    expect(classifyApprovalProvenance([applyRow("YOUR NAME", { version: 4 })], target)).toEqual({ kind: "PLACEHOLDER", approver: "YOUR NAME" });
    expect(classifyApprovalProvenance([applyRow("Asha Rao", { version: 4 })], target)).toEqual({ kind: "APPROVED", approver: "Asha Rao" });
    expect(classifyApprovalProvenance([attestRow("Asha Rao", { version: 5 }), applyRow("YOUR NAME", { version: 4 })], target).kind).toBe("ATTESTED");
  });
  test("an attestation for another content hash or another service does not count", () => {
    expect(classifyApprovalProvenance([attestRow("Asha Rao", { contentHash: "0".repeat(64) }), applyRow("YOUR NAME")], target).kind).toBe("PLACEHOLDER");
    expect(classifyApprovalProvenance([attestRow("Asha Rao", { serviceId: "cmother" }), applyRow("YOUR NAME")], target).kind).toBe("PLACEHOLDER");
  });
  test("with several applies of the same content, the newest one decides", () => {
    expect(classifyApprovalProvenance([applyRow("YOUR NAME"), applyRow("Asha Rao")], target)).toEqual({ kind: "PLACEHOLDER", approver: "YOUR NAME" });
    expect(classifyApprovalProvenance([applyRow("Asha Rao"), applyRow("YOUR NAME")], target)).toEqual({ kind: "APPROVED", approver: "Asha Rao" });
  });
  test("an attestation signed by a placeholder does not count", () => {
    expect(classifyApprovalProvenance([applyRow("YOUR NAME"), attestRow("<your name>")], target).kind).toBe("PLACEHOLDER");
  });
  test("an apply whose hash prefix is not this content's hash is not an approval of this content", () => {
    const other = applyRow("Asha Rao", { reason: "Phase 10 execution/safety/quality content 2026-09-28.draft.1 · deep-cleaning · hash ffffffffffffffff · approved by Asha Rao (2026-09-27T00:00:00Z)" });
    expect(classifyApprovalProvenance([other], target).kind).toBe("UNRECORDED");
  });
  test("rows for another service, unparsable rows and no rows are UNRECORDED", () => {
    expect(classifyApprovalProvenance([], target)).toEqual({ kind: "UNRECORDED" });
    expect(classifyApprovalProvenance([applyRow("Asha Rao", { serviceId: "cmother" })], target).kind).toBe("UNRECORDED");
    expect(classifyApprovalProvenance([{ description: "not json" }, { description: null }], target).kind).toBe("UNRECORDED");
  });
});

describe("attestation CLI refuses before touching any database", () => {
  // Clock-safe timed spawn (helpers/fresh-loop-clock): a stale loop clock expired this timeout at once.
  const run = (args: string[]) =>
    spawnSyncFreshClock(process.execPath, ["run", "scripts/phase10-attest-approval.ts", ...args], { cwd: join(import.meta.dir, "..", ".."), encoding: "utf8", timeout: 40_000 });
  test.each(["YOUR NAME", "<your name>", ""])("placeholder approver %p exits 2", async (name) => {
    const r = await run(["--url", "postgresql://nobody@127.0.0.1:1/homigo_test_none", "--approved-by", name]);
    expect(r.status).toBe(2);
    expect(`${r.stdout}${r.stderr}`).toMatch(/approver/i);
  }, 45_000);
  test("--url is required", async () => {
    expect((await run(["--approved-by", "Asha Rao"])).status).toBe(2);
  }, 45_000);
});
