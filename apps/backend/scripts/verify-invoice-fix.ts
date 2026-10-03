import "../src/load-env";
import { invoiceReportService } from "../src/services/invoice-report.service";

const PROVIDER_ID = "cmq9h687s0005tz8swhtkju1p";
const EARNING_ID = "cmszyq8qw03hptz20o6pa7zbj";

async function main() {
  const html = await invoiceReportService.partnerEarningHtml(PROVIDER_ID, EARNING_ID);
  if (!html) throw new Error("Invoice not found");

  console.log("=== Real generated invoice HTML (rows only) ===\n");
  const rows = html.match(/<div class="row[^>]*">.*?<\/div>/g) ?? [];
  for (const r of rows) {
    const clean = r.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    console.log(" ", clean);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR:", err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
