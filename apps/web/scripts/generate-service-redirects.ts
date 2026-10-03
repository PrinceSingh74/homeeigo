/**
 * Regenerates src/lib/catalog/service-redirects.json from the taxonomy.
 * Run after changing slugs, cross-listings or legacy beauty mappings:
 *   bun run scripts/generate-service-redirects.ts
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildCatalog, serviceRedirects } from "@/lib/catalog";

const redirects = serviceRedirects(buildCatalog(null));
const out = join(process.cwd(), "src", "lib", "catalog", "service-redirects.json");
writeFileSync(out, JSON.stringify(redirects, null, 2) + "\n");
console.log(`wrote ${redirects.length} redirects → ${out}`);
