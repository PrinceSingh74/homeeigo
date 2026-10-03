/**
 * Pins the contract between stuck-workflow DETECTION and RECOVERY.
 *
 * `POST /admin/governance/workflows/:id/recover` requires `observedStatus` and `observedUpdatedAt`
 * — the state the operator was looking at — so two simultaneous recoveries resolve to exactly one
 * winner instead of scheduling two wake-ups on one instance.
 *
 * `detectStuckInstances()` did not return `updatedAt`. The optimistic-concurrency requirement was
 * therefore unsatisfiable from the detector's own payload: any client would have had to re-read the
 * instance first and race the very window the check exists to close. Nothing caught it because
 * nothing called either endpoint — the console had no stuck-workflow surface at all while 16
 * instances were counted in `/metrics`.
 *
 * These are structural assertions over source, so they run without a database.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SERVICE = readFileSync(join(import.meta.dir, "..", "services", "workflow-recovery.service.ts"), "utf8");
const ROUTES = readFileSync(join(import.meta.dir, "..", "routes", "admin-governance.ts"), "utf8");
const PERMISSIONS = readFileSync(join(import.meta.dir, "..", "lib", "admin-route-permissions.ts"), "utf8");
const CONSOLE_PAGE = readFileSync(
  join(import.meta.dir, "..", "..", "..", "admin-panel", "src", "app", "(console)", "automation", "page.tsx"),
  "utf8",
);

describe("stuck workflow detection ↔ recovery contract", () => {
  it("detection returns every field recovery requires", () => {
    // Recovery's required inputs, read from the route's body schema.
    expect(ROUTES).toContain("observedStatus");
    expect(ROUTES).toContain("observedUpdatedAt");

    // Detection must therefore expose both status and updatedAt.
    expect(SERVICE).toMatch(/status:\s*WorkflowInstanceStatus/);
    expect(SERVICE).toMatch(/updatedAt:\s*string/);
    expect(SERVICE).toMatch(/updatedAt:\s*c\.updatedAt\.toISOString\(\)/);
  });

  it("keeps the recovery vocabulary to REQUEUE and CANCEL", () => {
    // There is no step-level compensation model in this platform. A third verb would have to
    // invent an inverse for a step that already ran.
    expect(ROUTES).toMatch(/t\.Literal\("REQUEUE"\)/);
    expect(ROUTES).toMatch(/t\.Literal\("CANCEL"\)/);
    expect(ROUTES).not.toMatch(/t\.Literal\("(REWIND|COMPENSATE|RETRY_STEP)"\)/);
  });

  it("requires a written reason on every recovery", () => {
    expect(ROUTES).toMatch(/reason:\s*t\.String\(\{\s*minLength:\s*10/);
  });

  it("never marks STALE_LEASE actionable — the executor reclaims those itself", () => {
    const staleBlock = SERVICE.slice(SERVICE.indexOf('reason: "STALE_LEASE"'));
    expect(staleBlock.slice(0, 400)).toMatch(/actionable:\s*false/);
    expect(staleBlock.slice(0, 400)).toMatch(/recommendedAction:\s*"NONE"/);
  });

  it("has RBAC rules for both endpoints, because unmatched admin routes are denied", () => {
    expect(PERMISSIONS).toMatch(/governance\\\/workflows\\\/stuck/);
    expect(PERMISSIONS).toMatch(/governance\\\/workflows\\\/\[\^\/\]\+\\\/recover/);
  });

  it("is reachable from the console, not just from the API", () => {
    expect(CONSOLE_PAGE).toContain("stuckWorkflows");
    expect(CONSOLE_PAGE).toContain("recoverWorkflow");
    // The operator sees the engine's evidence, not only its label.
    expect(CONSOLE_PAGE).toContain("row.evidence");
    // And cannot act on a row the engine says is not actionable.
    expect(CONSOLE_PAGE).toMatch(/!row\.actionable/);
  });
});
