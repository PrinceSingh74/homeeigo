/**
 * X-3 regression guard — ONE canonical capability mutation path, forever.
 *
 * History: `src/routes/partner-service-skills.routes.ts` was a dead, never-mounted duplicate of the
 * capability routes whose service twin (`requestServiceSkill`) wrote `data_origin = NULL` and
 * skipped the operational/membership gates. Mounting it by accident would have re-opened Q16. The
 * file was deleted on 2026-09-26 and the twin function made to refuse. These checks make a quiet
 * return of either path a test failure instead of a code-review coin-flip.
 */
import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const SRC = join(import.meta.dir, "..");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");

describe("X-3 — capability writes have exactly one home", () => {
  it("the dead duplicate route file stays deleted", () => {
    expect(existsSync(join(SRC, "routes/partner-service-skills.routes.ts"))).toBe(false);
  });

  it("no route file but the canonical two mounts capability mutations", () => {
    const offenders: string[] = [];
    for (const f of readdirSync(join(SRC, "routes"))) {
      if (!f.endsWith(".ts")) continue;
      if (f === "provider-capabilities.ts" || f === "admin-capabilities.ts") continue;
      const body = read(join("routes", f));
      // A POST/PATCH/DELETE touching capability tables or the capability service outside the two
      // canonical files is a second mutation path.
      if (/provider_service_capabilities|providerCapabilityService\.(declare|request|adminTransition|transition)/.test(body)) {
        offenders.push(f);
      }
    }
    expect(offenders).toEqual([]);
  });

  // Both twins wrote `data_origin = NULL` whatever the provider's provenance and skipped the
  // membership / eligibility gates of providerCapabilityService. `decideServiceSkill` (the admin
  // twin) was found still armed on 2026-09-28 with no importer.
  for (const twin of ["requestServiceSkill", "decideServiceSkill"]) {
    it(`the neutralised twin ${twin} still refuses (nobody re-armed it)`, () => {
      const body = read("services/partner-service-skills.service.ts");
      const at = body.indexOf(`export async function ${twin}`);
      expect(at).toBeGreaterThanOrEqual(0);
      const fn = body.slice(at);
      const head = fn.slice(0, fn.indexOf("const provider =") > 0 ? fn.indexOf("const provider =") : 600);
      expect(head).toContain('return { ok: false, error: "NOT_DEPLOYED" }');
      expect(head).toContain("X-3");
    });
  }

  it("nothing imports the twin's ungated writer", () => {
    const importers: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(join(SRC, dir), { withFileTypes: true })) {
        if (e.isDirectory()) { if (e.name !== "__tests__" && e.name !== "node_modules") walk(join(dir, e.name)); continue; }
        if (!e.name.endsWith(".ts")) continue;
        const p = join(dir, e.name);
        if (p.includes("partner-service-skills.service")) continue;
        if (/\b(requestServiceSkill|decideServiceSkill)\b/.test(read(p))) importers.push(p);
      }
    };
    walk("routes");
    walk("services");
    expect(importers).toEqual([]);
  });
});
