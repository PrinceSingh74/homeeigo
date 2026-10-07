/**
 * The frontends hand-declare the backend's service contracts instead of importing them, so a clean
 * typecheck proves only that each copy agrees with itself. These checks read the copies and fail
 * when they drift from the backend source of truth.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { partnerJobBrief } from "../lib/service-domain";
import { partnerJobEarningView } from "../lib/earning-settlement";

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
  test("web add-on display does not ship a shared price list", () => {
    const src = read("apps/web/src/lib/catalog/pricing.ts");
    expect(src).not.toContain("BOOKING_ADDONS");
    expect(src).not.toContain("Fridge Cleaning");
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

  test("partner web declares every field of the per-job earning (Phase 13 P2)", () => {
    const view = partnerJobEarningView({
      id: "e1", bookingId: "b1", grossAmount: 100, commission: 20, netEarning: 80, paymentStatus: "CREDITED", createdAt: new Date(0),
    });
    const web = typeBlock(read("apps/partner-web/src/types/partner.ts"), "PartnerJobEarning");
    for (const k of Object.keys(view)) expect(web).toContain(`${k}:`);
    const line = typeBlock(read("apps/partner-web/src/types/partner.ts"), "PartnerEarningLine");
    for (const k of Object.keys(view.lines[0]!)) expect(line).toContain(`${k}:`);
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
