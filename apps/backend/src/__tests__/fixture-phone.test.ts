/**
 * `fixturePhone` feeds a UNIQUE column (users.phone_hash). The old digit-splicing version left ~10^6
 * values per run, so seeding 500 customers collided in roughly one run in five and failed a suite before
 * its assertion ever ran. Pure test — no database.
 */
import { describe, expect, test } from "bun:test";
import { fixturePhone } from "./helpers/adversarial-fixtures";

describe("fixturePhone", () => {
  test("is deterministic and a valid Indian mobile", () => {
    expect(fixturePhone("run-x", 7)).toBe(fixturePhone("run-x", 7));
    for (let i = 0; i < 200; i++) expect(fixturePhone(`run-${i}`, `slot-${i}`)).toMatch(/^\+91[6-9]\d{9}$/);
  });

  test("a heavy seeding (the release-blocker shape) does not collide across many run ids", () => {
    const tags = ["c250-96", "c500-0", "upd-race"];
    const size = (t: string) => (t.startsWith("upd") ? 50 : Number(t.slice(1).split("-")[0]));
    let colliding = 0;
    for (let r = 0; r < 200; r++) {
      const runId = `rbe-${(1789800000000 + r * 7919).toString(36)}`;
      const seen = new Set<string>();
      let hit = false;
      for (const t of tags) {
        for (let i = 0; i < size(t); i++) {
          const phone = fixturePhone(runId, `race-${t}-${i}`);
          if (seen.has(phone)) hit = true;
          seen.add(phone);
        }
      }
      if (hit) colliding++;
    }
    // The previous implementation collided in 27 of these 200 runs.
    expect(colliding).toBe(0);
  });
});
