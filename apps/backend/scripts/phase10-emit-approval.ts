/**
 * Emits the owner-approval file for the content apply-plan.
 *
 * The apply-plan refuses any slug not listed in an approval file whose content hash matches the
 * draft at approval time — so an approval is BOUND to exact content, and editing the draft after
 * approval voids it. This emitter writes that file for the slugs whose draft status is
 * DRAFT_FOR_OWNER_REVIEW (never the OWNER_APPROVAL_REQUIRED / SAFETY_HOLD ones), using the same
 * hash function the apply-plan checks.
 *
 *   bun run scripts/phase10-emit-approval.ts --approved-by "<name>" --out <file.json>
 */
import { existsSync, writeFileSync } from "node:fs";
import { DRAFT, DRAFT_VERSION } from "./data/phase-10-execution-safety-content-draft";
import { isValidApproverName } from "./lib/approver-name";
import { contentHash } from "./phase10-content-apply-plan";

const byIdx = process.argv.indexOf("--approved-by");
const approvedBy = byIdx >= 0 ? process.argv[byIdx + 1] : undefined;
const outIdx = process.argv.indexOf("--out");
const out = outIdx >= 0 ? process.argv[outIdx + 1] : undefined;
if (!isValidApproverName(approvedBy) || !out) {
  console.error('usage: --approved-by "<real owner name>" --out <file.json>');
  process.exit(2);
}
const services = Object.entries(DRAFT)
  .filter(([, d]) => d.status === "DRAFT_FOR_OWNER_REVIEW")
  .map(([slug]) => ({ slug, contentHash: contentHash(slug) }));
const approval = { approvedBy, approvedAt: new Date().toISOString(), draftVersion: DRAFT_VERSION, services };
// An approval file is provenance: never overwrite one (the 2026-09-29 "YOUR NAME" file is kept as
// history). "wx" fails if the path exists, so a race between two emitters cannot overwrite either.
if (existsSync(out)) {
  console.error(`refusing: ${out} already exists — an approval file is never overwritten; choose a new --out path`);
  process.exit(2);
}
try {
  writeFileSync(out, JSON.stringify(approval, null, 2), { flag: "wx" });
} catch (e) {
  console.error(`refusing: could not create ${out} (${e instanceof Error ? e.message : String(e)})`);
  process.exit(2);
}
console.log(`[emit-approval] ${services.length} DRAFT_FOR_OWNER_REVIEW slug(s) → ${out} (draftVersion ${DRAFT_VERSION})`);
