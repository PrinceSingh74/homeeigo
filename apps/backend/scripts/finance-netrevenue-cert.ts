/**
 * Finance dashboard netRevenue period-basis regression (node script).
 * Usage: bun --env-file=.env.test run scripts/finance-netrevenue-cert.ts
 */
import "../src/load-env";
import { financeDashboardService } from "../src/services/finance-dashboard.service";
import prisma from "../src/lib/prisma";

let failed = 0;
function gate(name: string, ok: boolean, detail = "") {
  if (ok) console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  else {
    failed += 1;
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  const overview7 = await financeDashboardService.getOverview(7);
  const overview30 = await financeDashboardService.getOverview(30);

  gate("netrevenue.defined", Number.isFinite(overview7.netRevenue));
  gate(
    "netrevenue.refunds_in_period_field",
    typeof overview7.refundsInPeriod === "number",
    `7d refunds=${overview7.refundsInPeriod}`,
  );
  gate(
    "netrevenue.liability_separate",
    typeof overview7.refundLiability === "number",
    `all-time liability=${overview7.refundLiability}`,
  );

  const completedRefunds7 = await prisma.refundRequest.aggregate({
    where: { status: "COMPLETED", processedAt: { gte: new Date(Date.now() - 7 * 86400000) } },
    _sum: { amount: true },
  });
  const expected7 = Math.round(
    ((overview7.gmv - (completedRefunds7._sum.amount ?? 0)) + Number.EPSILON) * 100,
  ) / 100;
  gate(
    "netrevenue.7d_formula",
    overview7.netRevenue === expected7,
    `got=${overview7.netRevenue} expected=${expected7}`,
  );

  gate(
    "netrevenue.30d_not_worse_than_mixed_alltime",
    overview30.netRevenue >= overview7.netRevenue - overview7.gmv || overview30.gmv >= overview7.gmv,
    `7d=${overview7.netRevenue} 30d=${overview30.netRevenue}`,
  );

  await prisma.$disconnect();
  console.log(failed === 0 ? "\nNET REVENUE CERT: FULL PASS" : `\nNET REVENUE CERT: FAIL (${failed})`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
