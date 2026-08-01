/**
 * Run the PostgreSQL → BigQuery analytics ETL once and print row counts.
 *   bun run --env-file=.env src/scripts/run-etl.ts
 * Requires ADC (gcloud auth application-default login) or GOOGLE_APPLICATION_CREDENTIALS.
 */
import { runEtl } from "../services/analytics-etl.service";

const t0 = Date.now();
runEtl()
  .then((counts) => {
    console.log("✅ ETL complete in", ((Date.now() - t0) / 1000).toFixed(1) + "s");
    for (const [table, n] of Object.entries(counts)) console.log(`   ${table.padEnd(22)} ${n} rows`);
    process.exit(0);
  })
  .catch((err) => {
    console.error("❌ ETL failed:", err?.message ?? err);
    process.exit(1);
  });
