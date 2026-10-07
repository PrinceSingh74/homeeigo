/**
 * Sets the materials and equipment policy on the live commercial services that have none, through
 * the governed catalogue write (a new version, the audit row, the live-edit regression check), never
 * by touching `catalog_config` directly.
 *
 *   cd apps/backend
 *   bun --env-file=.env run scripts/set-live-responsibility-policies.ts            # plan only
 *   bun --env-file=.env run scripts/set-live-responsibility-policies.ts --apply <admin user id>
 *
 * The policies are the owner's decision of 2026-10-07, delegated to this work ("what is right for
 * the project"), and follow the published customer copy (apps/web/src/lib/catalog/service-detail-copy.ts):
 * everyday home help uses the customer's usual supplies and the home's own equipment, with anything
 * extra brought by the professional (MIXED materials, CUSTOMER_PROVIDED equipment); a dedicated or
 * specialised clean, salon work and car cleaning bring their own products and kit
 * (PROFESSIONAL_PROVIDED); plant care uses the customer's plants and soil with the professional's
 * tools. Any of them can be changed in the admin service editor.
 *
 * A service that already has a policy set is left alone.
 */
import "../src/load-env";
import prisma from "../src/lib/prisma";
import { catalogService } from "../src/services/catalog.service";

type Policy = "CUSTOMER_PROVIDED" | "PROFESSIONAL_PROVIDED" | "PACKAGE_INCLUDED" | "MIXED" | "NOT_REQUIRED";
type Decision = { materialPolicy: Policy; equipmentPolicy: Policy; why: string };

const EVERYDAY: Decision = {
  materialPolicy: "MIXED",
  equipmentPolicy: "CUSTOMER_PROVIDED",
  why: "everyday home help: the customer's usual supplies and the home's own equipment; anything extra is brought and confirmed by the professional",
};
const DEDICATED: Decision = {
  materialPolicy: "PROFESSIONAL_PROVIDED",
  equipmentPolicy: "PROFESSIONAL_PROVIDED",
  why: "a dedicated or specialised service: the professional brings the products and the kit",
};
const PLANTS: Decision = {
  materialPolicy: "CUSTOMER_PROVIDED",
  equipmentPolicy: "PROFESSIONAL_PROVIDED",
  why: "plant care: the customer's plants, pots and soil; the professional's tools",
};

/** By service name, as the live catalogue names them. Unlisted services are reported, not changed. */
const DECISIONS: Record<string, Decision> = {
  "Hourly Bookings": EVERYDAY,
  "Dusting & Wiping": EVERYDAY,
  "Sweeping & Mopping": EVERYDAY,
  "Utensils": EVERYDAY,
  "Kitchen Prep": EVERYDAY,
  "Laundry": EVERYDAY,
  "Ironing & Folding": EVERYDAY,
  "Packing or Unpacking": EVERYDAY,
  "Kitchen Cleaning": DEDICATED,
  "Bathroom Cleaning": DEDICATED,
  "Deep Cleaning": DEDICATED,
  "Balcony Cleaning": DEDICATED,
  "Window Cleaning": DEDICATED,
  "Fan Cleaning": DEDICATED,
  "Fridge Cleaning": DEDICATED,
  "Kitchen Cabinet Cleaning": DEDICATED,
  "Complete Wardrobe Cleaning": DEDICATED,
  "Sofa Deep Cleaning": DEDICATED,
  "Carpet Shampooing": DEDICATED,
  "Mattress Sanitization": DEDICATED,
  "Pre-Party Express Clean": DEDICATED,
  "After-Party Express Clean": DEDICATED,
  "Car Surface Cleaning": DEDICATED,
  "Salon at Home": DEDICATED,
  "Plant Care": PLANTS,
};

const apply = process.argv.includes("--apply");
const adminId = process.argv[process.argv.indexOf("--apply") + 1];
if (apply && (!adminId || adminId.startsWith("--"))) throw new Error("--apply needs the acting admin's user id");

const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
const live = await prisma.service.findMany({
  where: { isActive: true, lifecycleStatus: "ACTIVE" },
  select: { id: true, name: true, version: true, catalogConfig: true },
  orderBy: { name: "asc" },
});
console.log(`${db}: ${live.length} live services`);

let changed = 0;
for (const s of live) {
  const cfg = (s.catalogConfig ?? {}) as Record<string, unknown>;
  const has = (k: string) => typeof cfg[k] === "string" && cfg[k] !== "NOT_SPECIFIED";
  if (has("materialPolicy") && has("equipmentPolicy")) {
    console.log(`  = ${s.name}: already set (${cfg.materialPolicy} / ${cfg.equipmentPolicy})`);
    continue;
  }
  const decision = DECISIONS[s.name];
  if (!decision) {
    console.log(`  ? ${s.name}: no decision recorded — left alone`);
    continue;
  }
  const next = {
    ...cfg,
    ...(has("materialPolicy") ? {} : { materialPolicy: decision.materialPolicy }),
    ...(has("equipmentPolicy") ? {} : { equipmentPolicy: decision.equipmentPolicy }),
  };
  console.log(`  ${apply ? "→" : "·"} ${s.name} (v${s.version}): materials ${next.materialPolicy}, equipment ${next.equipmentPolicy} — ${decision.why}`);
  if (!apply) continue;
  const result = await catalogService.update(
    s.id,
    { catalogConfig: next, expectedVersion: s.version, changeReason: `Materials and equipment policy set (owner's decision of 2026-10-07): ${decision.why}` },
    adminId,
  );
  if ("error" in result && result.error) {
    console.log(`    REFUSED: ${result.error} ${"message" in result ? String(result.message ?? "") : ""} ${JSON.stringify(result).slice(0, 400)}`);
    continue;
  }
  changed += 1;
}
console.log(apply ? `applied to ${changed} services` : "plan only — nothing written (add --apply <admin user id>)");
await prisma.$disconnect();
process.exit(0);
