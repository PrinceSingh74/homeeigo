/**
 * The job-action policy exists in THREE copies. This keeps them honest.
 *
 *   apps/backend/src/lib/partner-job-fsm.ts        the authority
 *   apps/partner-web/src/lib/job-action-policy.ts  optimistic client mirror
 *   homigo-partner-mobile/src/lib/job-action-policy.ts   the same, again
 *
 * They are mirrors by deliberate choice — the clients render CTAs from cached list rows before the
 * server answers — but a mirror that drifts is worse than no mirror: on 2026-09-23 all three
 * derived `CUSTOMER_NO_SHOW` as `ARRIVED`, so the partner app offered "Start service" on a booking
 * that was already closed and refunded, and `EXPIRED` as `OFFERED`, offering *Accept* on a released
 * slot. Fixing one copy would have left the other two wrong.
 *
 * `apps/partner-web` has no unit-test runner of its own, so this file is the executable regression
 * protection for its copy. It reads source TEXT rather than importing, because the client modules
 * use path aliases and JSX-era tooling that this runtime cannot resolve — and because the property
 * worth pinning is "the three lists agree", which is a textual fact.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JOB_TERMINAL_OUTCOMES } from "../lib/partner-job-fsm";

const REPO = resolve(import.meta.dir, "../../../..");
const MIRRORS = {
  "partner-web": "apps/partner-web/src/lib/job-action-policy.ts",
  "partner-mobile": "homigo-partner-mobile/src/lib/job-action-policy.ts",
} as const;

const read = (rel: string) => readFileSync(resolve(REPO, rel), "utf8");

/** The statuses a mirror short-circuits on BEFORE it starts reading timestamps. */
function earlyStatusChecks(source: string): Set<string> {
  // The derivation starts at the first `status === "REJECTED"` — the first branch every copy has —
  // and the status-first section runs until the first timestamp is consulted. Anchoring on
  // REJECTED rather than a function name keeps this working across the three files' differing
  // shapes, and skips the `hasTs` HELPER definition, which otherwise ends the slice immediately.
  const start = source.indexOf('status === "REJECTED"');
  if (start < 0) throw new Error("no REJECTED branch found — the mirror's shape changed");
  const rest = source.slice(start);
  const firstTs = rest.search(/hasTs\(job\.|hasTs\(input\./);
  const head = firstTs < 0 ? rest : rest.slice(0, firstTs);
  return new Set([...head.matchAll(/status === "([A-Z_]+)"/g)].map((m) => m[1]!));
}

describe("the three copies of the job-action policy agree", () => {
  for (const [name, rel] of Object.entries(MIRRORS)) {
    test(`${name} reads every terminal status before any timestamp`, () => {
      const source = read(rel);
      const early = earlyStatusChecks(source);
      for (const terminal of JOB_TERMINAL_OUTCOMES) {
        if (terminal === "CANCELLED") {
          // The backend spells this one across three booking statuses; the mirrors do too.
          expect(early.has("CANCELLED") || early.has("CANCELLED_BY_USER")).toBe(true);
          continue;
        }
        expect(
          early.has(terminal),
          `${rel} does not short-circuit on ${terminal} before reading timestamps — a row carrying arrivedAt will derive as a LIVE stage`,
        ).toBe(true);
      }
    });

    test(`${name} declares the same terminal stages in its union`, () => {
      const source = read(rel) + (name === "partner-web" ? read("apps/partner-web/src/types/partner.ts") : "");
      for (const terminal of JOB_TERMINAL_OUTCOMES) {
        expect(source.includes(`"${terminal}"`), `${rel} has no "${terminal}" in its stage union`).toBe(true);
      }
    });

    test(`${name} knows the actions the backend can send`, () => {
      const source = read(rel) + (name === "partner-web" ? read("apps/partner-web/src/types/partner.ts") : "");
      // REPORT_NO_SHOW is the newest; an action the client cannot name renders as nothing.
      expect(source.includes('"REPORT_NO_SHOW"')).toBe(true);
    });
  }

  test("the backend's own terminal list still contains the three that caused the defect", () => {
    for (const s of ["EXPIRED", "CUSTOMER_NO_SHOW", "PROVIDER_NO_SHOW"]) {
      expect(JOB_TERMINAL_OUTCOMES as readonly string[]).toContain(s);
    }
  });
});

/**
 * The customer cancel rule is duplicated too — web and mobile each carry a copy so the button can
 * be decided from a cached list row. They must stay the SAME rule: if one app lets a customer
 * cancel a started job and the other does not, one of them is handing out a 409.
 */
describe("the customer cancel rule is the same rule in both customer apps", () => {
  const WEB = "apps/web/src/lib/booking-cancel-rules.ts";
  const MOBILE = "homigo-mobile/src/lib/booking-cancel-rules.ts";

  test("the two copies are byte-identical apart from line endings", () => {
    const strip = (s: string) => s.replace(/\r\n/g, "\n");
    expect(strip(read(WEB))).toBe(strip(read(MOBILE)));
  });

  test("neither copy lets a customer cancel a started job (O3b)", () => {
    for (const rel of [WEB, MOBILE]) {
      const source = read(rel);
      // The allow-list must not contain in_progress, and must still contain the pre-start statuses.
      const list = source.slice(source.indexOf("CUSTOMER_CANCELLABLE"), source.indexOf("]);"));
      expect(list.includes("in_progress"), `${rel} still allows cancelling a started job`).toBe(false);
      for (const allowed of ["pending", "accepted", "assigned", "en_route"]) {
        expect(list.includes(allowed), `${rel} no longer allows cancelling while ${allowed}`).toBe(true);
      }
    }
  });
});
