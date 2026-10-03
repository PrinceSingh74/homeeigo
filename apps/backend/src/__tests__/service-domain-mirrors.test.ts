/**
 * The frontends hand-declare the backend's service contracts instead of importing them, so a clean
 * typecheck proves only that each copy agrees with itself. These checks read the copies and fail
 * when they drift from the backend source of truth.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BOOKING_ADDONS } from "../lib/service-catalog-config";
import { partnerJobBrief } from "../lib/service-domain";

const repo = join(import.meta.dir, "../../../..");
const read = (rel: string) => readFileSync(join(repo, rel), "utf8");

/** The text of one `export type Name = { … };` block (brace-balanced). */
function typeBlock(src: string, name: string): string {
  const start = src.indexOf(`export type ${name} =`);
  if (start < 0) throw new Error(`type ${name} not found`);
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unbalanced ${name}`);
}

describe("frontend mirrors of the service contract", () => {
  test("web shared add-on display list matches the server catalogue (ids, names, prices)", () => {
    const src = read("apps/web/src/lib/catalog/pricing.ts");
    const block = src.slice(src.indexOf("export const BOOKING_ADDONS"), src.indexOf("] as const", src.indexOf("export const BOOKING_ADDONS")));
    const rows = [...block.matchAll(/id:\s*"([^"]+)",\s*name:\s*"([^"]+)"[^}]*price:\s*(\d+)/g)].map((m) => ({
      id: m[1],
      name: m[2],
      price: Number(m[3]),
    }));
    expect(rows).toEqual(BOOKING_ADDONS.map((a) => ({ id: a.id, name: a.name, price: a.price })));
  });

  test("partner web and partner mobile declare every field of the job brief", () => {
    const keys = Object.keys(partnerJobBrief(null, null, 1));
    const web = typeBlock(read("apps/partner-web/src/types/partner.ts"), "PartnerJobBrief");
    const mobileSrc = read("homigo-partner-mobile/src/types/partner.ts");
    const mobile = mobileSrc.slice(mobileSrc.indexOf("job?: {"), mobileSrc.indexOf("execution?: {"));
    for (const k of keys) {
      expect(web).toContain(`${k}:`);
      expect(mobile).toContain(`${k}:`);
    }
  });

  test("web resolve-selection mirror declares the fields the page reads", () => {
    const t = typeBlock(read("apps/web/src/types/backend.ts"), "ServiceResolution");
    for (const k of ["serviceVersion", "ok", "issues", "addonAvailability", "pricing", "subtotal", "duration"]) {
      expect(t).toContain(k);
    }
  });

  test("admin mirror declares lifecycle, taxonomy and identity fields the console renders", () => {
    const t = typeBlock(read("apps/admin-panel/src/services/admin-api.ts"), "AdminServiceRow");
    for (const k of ["internalServiceCode", "allowedTransitions", "taxonomy", "version", "updatedAt", "reservedSlotMinutes"]) {
      expect(t).toContain(k);
    }
  });
});
