/**
 * Read-only: lists customer-visible services that did not come through the governed publish path
 * (no published version row). Exit code 1 when any exist.
 *
 *   cd apps/backend
 *   bun --env-file=.env run scripts/check-service-governance.ts
 *
 * Such a row was written straight into the database (a seed script, a manual insert). It is not
 * unpublished by this script: review it in the admin console, then publish or pause it there.
 */
import "../src/load-env";
import prisma from "../src/lib/prisma";
import { catalogService } from "../src/services/catalog.service";

const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
const found = await catalogService.ungovernedLiveServices();
console.log(`database ${db}: ${found.length} customer-visible service(s) without a published version`);
for (const s of found) console.log(`  ${s.slug}  (${s.name})  ${s.lifecycleStatus}  ${s.reason}`);
process.exit(found.length ? 1 : 0);
