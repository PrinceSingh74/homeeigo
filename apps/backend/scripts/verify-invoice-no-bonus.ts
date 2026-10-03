import "../src/load-env";
import prisma from "../src/lib/prisma";
import { invoiceReportService } from "../src/services/invoice-report.service";

async function main() {
  // Find an earning where netEarning === grossAmount - commission (no bonus/deduction) for a clean control case.
  const candidates = await prisma.earning.findMany({
    select: { id: true, providerId: true, grossAmount: true, commission: true, netEarning: true },
    take: 200,
  });
  const clean = candidates.find(
    (e) => Math.round((e.netEarning - (e.grossAmount - e.commission)) * 100) / 100 === 0,
  );
  if (!clean) {
    console.log("No zero-adjustment earning found in first 200 rows — skipping control check");
    process.exit(0);
  }
  console.log("Control case (no bonus/deduction expected):", JSON.stringify(clean));

  const html = await invoiceReportService.partnerEarningHtml(clean.providerId, clean.id);
  const rows = (html!.match(/<div class="row[^>]*">.*?<\/div>/g) ?? []).map((r) =>
    r.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
  );
  console.log("\nGenerated rows:");
  rows.forEach((r) => console.log(" ", r));

  const hasBonusRow = rows.some((r) => r.includes("bonus") || r.includes("Adjustment"));
  console.log("\nBonus/Adjustment row present:", hasBonusRow, "(should be false for a clean case)");

  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR:", err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
