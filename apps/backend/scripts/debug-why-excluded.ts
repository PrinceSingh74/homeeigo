import "../src/load-env";
import prisma from "../src/lib/prisma";
import { resolveServiceMatchTokens, serviceCategoryMatchWhere } from "../src/lib/service-match";

const SERVICE_ID = "cmr68qqbg0001tzb8vmeifvz6"; // Fridge Cleaning
const REAL_PROVIDER_IDS = ["cmq9h687s0005tz8swhtkju1p", "cmsitqxy40002tzbczjyo2ex8"];

async function main() {
  const matchTokens = await resolveServiceMatchTokens(SERVICE_ID);
  console.log("matchTokens:", JSON.stringify(matchTokens, null, 2));

  const whereClause = {
    ...serviceCategoryMatchWhere(matchTokens!),
    isActive: true,
    isApproved: true,
    isBanned: false,
    pausedAt: null,
    user: { isBanned: false },
  };
  console.log("\nFull WHERE clause used by findBestProviders:");
  console.log(JSON.stringify(whereClause, null, 2));

  console.log("\n--- Checking raw provider rows for the two real demo accounts ---");
  const raw = await prisma.provider.findMany({
    where: { id: { in: REAL_PROVIDER_IDS } },
    select: {
      id: true, isActive: true, isApproved: true, isBanned: true, pausedAt: true,
      currentStatus: true, isOnline: true, serviceCategories: true,
      user: { select: { email: true, isBanned: true } },
    },
  });
  console.log(JSON.stringify(raw, null, 2));

  console.log("\n--- Do they pass the FULL findBestProviders WHERE clause? ---");
  const passing = await prisma.provider.findMany({
    where: { ...whereClause, id: { in: REAL_PROVIDER_IDS } },
    select: { id: true, user: { select: { email: true } } },
  });
  console.log("Providers that PASS the query:", JSON.stringify(passing, null, 2));

  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR:", err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
