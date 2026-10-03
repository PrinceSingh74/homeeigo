/**
 * Phase 10 owner-approval provenance — a placeholder approver can never produce an approval file,
 * an apply, or an audit row, and an existing approval file is never silently rewritten.
 *
 * History (kept, not rewritten): on 2026-09-29 `backups/phase10-approval.json` was emitted with
 * `"approvedBy": "YOUR NAME"` and the 25 contents were applied to homigo_db under it. The emitter
 * then wrote with a plain overwrite, so the next emission to the same path would have erased that
 * evidence. These tests pin the forward-looking guard.
 */
import { describe, expect, test } from "bun:test";
import { spawnSyncFreshClock } from "./helpers/fresh-loop-clock";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isValidApproverName } from "../../scripts/lib/approver-name";
import { approvalFor, contentHash, type Approval } from "../../scripts/phase10-content-apply-plan";
import { DRAFT, DRAFT_VERSION } from "../../scripts/data/phase-10-execution-safety-content-draft";

const BACKEND = join(import.meta.dir, "..", "..");
const PLACEHOLDERS = ["YOUR NAME", "your name", "  Your   Name ", "<your name>", "owner name", "<owner name>", "your_name", "owner_name", "<approver>", "<>", "$OWNER", "${OWNER}", "   ", "", "12345", "---"];

describe("approver name", () => {
  test.each(PLACEHOLDERS)("placeholder %p is refused", (name) => {
    expect(isValidApproverName(name)).toBe(false);
  });
  test.each(["Asha Rao", "Kapiissh Green", "REHEARSAL-not-owner", "Owner", "Ana-María Ó'Neil"])("real name %p is accepted", (name) => {
    expect(isValidApproverName(name)).toBe(true);
  });
  test("non-strings are refused", () => {
    expect(isValidApproverName(undefined)).toBe(false);
    expect(isValidApproverName(null)).toBe(false);
    expect(isValidApproverName(42)).toBe(false);
  });
});

describe("apply-plan approval gate", () => {
  const slug = Object.entries(DRAFT).find(([, d]) => d.status === "DRAFT_FOR_OWNER_REVIEW")![0];
  const approval = (approvedBy: string): Approval => ({ approvedBy, approvedAt: "2026-09-29T05:24:02.246Z", draftVersion: DRAFT_VERSION, services: [{ slug, contentHash: contentHash(slug) }] });

  test("an approval FILE signed with a placeholder is refused as a placeholder, whatever the command line says", () => {
    expect(approvalFor(slug, approval("YOUR NAME"), "YOUR NAME")).toEqual({ ok: false, reason: "REFUSED_PLACEHOLDER_APPROVER" });
    expect(approvalFor(slug, approval("YOUR NAME"), "Asha Rao")).toEqual({ ok: false, reason: "REFUSED_PLACEHOLDER_APPROVER" });
  });
  test("a placeholder on the command line is refused as a placeholder", () => {
    expect(approvalFor(slug, approval("Asha Rao"), "<your name>")).toEqual({ ok: false, reason: "REFUSED_PLACEHOLDER_APPROVER" });
  });
  test("a real, matching approver still passes (control)", () => {
    expect(approvalFor(slug, approval("Asha Rao"), "  asha   rao ")).toEqual({ ok: true });
  });
  test("two different real names are a mismatch, not a placeholder", () => {
    expect(approvalFor(slug, approval("Asha Rao"), "Someone Else")).toEqual({ ok: false, reason: "REFUSED_APPROVER_MISMATCH" });
  });
});

describe("emit-approval CLI", () => {
  // Clock-safe timed spawn (helpers/fresh-loop-clock): a stale loop clock expired this timeout at once.
  const emit = (args: string[]) =>
    spawnSyncFreshClock(process.execPath, ["run", "scripts/phase10-emit-approval.ts", ...args], { cwd: BACKEND, encoding: "utf8", timeout: 40_000 });
  const approvable = Object.values(DRAFT).filter((d) => d.status === "DRAFT_FOR_OWNER_REVIEW").length;

  test.each(["YOUR NAME", "<your name>", "$OWNER"])("placeholder %p exits 2 and writes no file", async (name) => {
    const dir = mkdtempSync(join(tmpdir(), "p10-approval-"));
    try {
      const out = join(dir, "approval.json");
      const r = await emit(["--approved-by", name, "--out", out]);
      expect(r.status).toBe(2);
      expect(existsSync(out)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 45_000);

  test("a real name writes the approval for every DRAFT_FOR_OWNER_REVIEW service", async () => {
    const dir = mkdtempSync(join(tmpdir(), "p10-approval-"));
    try {
      const out = join(dir, "approval.json");
      const r = await emit(["--approved-by", "Asha Rao", "--out", out]);
      expect(r.status).toBe(0);
      const j = JSON.parse(readFileSync(out, "utf8")) as Approval;
      expect(j.approvedBy).toBe("Asha Rao");
      expect(j.draftVersion).toBe(DRAFT_VERSION);
      expect(j.services.length).toBe(approvable);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 45_000);

  test("an existing approval file is never overwritten — it is provenance", async () => {
    const dir = mkdtempSync(join(tmpdir(), "p10-approval-"));
    try {
      const out = join(dir, "approval.json");
      const historical = JSON.stringify({ approvedBy: "YOUR NAME", approvedAt: "2026-09-29T05:24:02.246Z", draftVersion: DRAFT_VERSION, services: [] }, null, 2);
      writeFileSync(out, historical);
      const r = await emit(["--approved-by", "Asha Rao", "--out", out]);
      expect(r.status).toBe(2);
      expect(readFileSync(out, "utf8")).toBe(historical);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 45_000);
});
