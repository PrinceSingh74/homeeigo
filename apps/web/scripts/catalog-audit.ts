/**
 * Services catalogue audit against the live API.
 *   bun run scripts/catalog-audit.ts [apiBase=http://127.0.0.1:3000] [--json]
 *
 * Classifies every catalogue service and every active backend record:
 *   ACTIVE_BOOKABLE      live, fully configured
 *   ACTIVE_CONFIG_GAPS   live and bookable, but configuration is incomplete (listed)
 *   COMING_SOON          no active backend record, or admin-flagged coming soon
 *   HIDDEN_INTERNAL      active backend record that is test/unreviewed data — never shown
 */
import { buildCatalog, isCustomerFacingService, priceText, CATEGORY_BY_ID } from "@/lib/catalog";
import type { BackendService } from "@/types/backend";

const base = (process.argv.find((a) => a.startsWith("http")) ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const res = await fetch(`${base}/api/services?limit=100`);
if (!res.ok) throw new Error(`GET /api/services → ${res.status}`);
const backend = ((await res.json()) as { data: { services: BackendService[] } }).data.services;
const catalog = buildCatalog(backend);

type RowOut = { status: string; category: string; name: string; slug: string; price: string; image: string; gaps: string[] };
const rows: RowOut[] = catalog.services.map((s) => ({
  status: s.status === "coming-soon" ? "COMING_SOON" : s.gaps.length ? "ACTIVE_CONFIG_GAPS" : "ACTIVE_BOOKABLE",
  category: CATEGORY_BY_ID.get(s.category)!.name,
  name: s.name,
  slug: s.href,
  price: priceText(s).label,
  image: s.status !== "live" ? "icon (coming soon)" : s.image ? "curated/admin image" : "icon artwork (approved fallback)",
  gaps: s.gaps,
}));

const bound = new Set(catalog.services.map((s) => s.backendId).filter(Boolean));
for (const b of backend) {
  if (bound.has(b.id)) continue;
  rows.push({
    status: isCustomerFacingService(b) ? "UNBOUND_ACTIVE" : "HIDDEN_INTERNAL",
    category: `(backend: ${b.category})`,
    name: b.name,
    slug: b.slug ?? "",
    price: `₹${b.basePrice}`,
    image: "-",
    gaps: [],
  });
}

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(rows, null, 2));
} else {
  const counts = rows.reduce<Record<string, number>>((m, r) => ((m[r.status] = (m[r.status] ?? 0) + 1), m), {});
  console.log(`catalogue services: ${catalog.services.length} · backend active records: ${backend.length}`);
  console.log(counts);
  for (const status of ["ACTIVE_BOOKABLE", "ACTIVE_CONFIG_GAPS", "COMING_SOON", "UNBOUND_ACTIVE", "HIDDEN_INTERNAL"]) {
    const list = rows.filter((r) => r.status === status);
    if (!list.length) continue;
    console.log(`\n## ${status} (${list.length})`);
    for (const r of list) {
      console.log(`- ${r.name} · ${r.category} · ${r.slug} · ${r.price} · ${r.image}`);
      for (const g of r.gaps) console.log(`    gap: ${g}`);
    }
  }
}
