import { BigQuery } from "@google-cloud/bigquery";
import { ANALYTICS_CONFIG, BQ_DATASETS } from "../config";
import { projectRows } from "./table-schemas";

let _bq: BigQuery | null = null;

export function getBigQuery(): BigQuery {
  if (!_bq) _bq = new BigQuery({ projectId: ANALYTICS_CONFIG.projectId });
  return _bq;
}

export function fqTable(layer: keyof typeof BQ_DATASETS, tableId: string): string {
  const dataset = BQ_DATASETS[layer];
  return `\`${ANALYTICS_CONFIG.projectId}.${dataset}.${tableId}\``;
}

export async function bqQuery<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  const [rows] = await getBigQuery().query({ query: sql, location: ANALYTICS_CONFIG.location });
  return rows as T[];
}

export async function loadRows(
  layer: keyof typeof BQ_DATASETS,
  tableId: string,
  rows: Record<string, unknown>[],
  writeDisposition: "WRITE_TRUNCATE" | "WRITE_APPEND" = "WRITE_APPEND",
): Promise<number> {
  if (rows.length === 0) return 0;
  const projected = projectRows(tableId, rows);
  const dataset = BQ_DATASETS[layer];
  const table = getBigQuery().dataset(dataset).table(tableId);
  await new Promise<void>((resolve, reject) => {
    const stream = table.createWriteStream({
      sourceFormat: "NEWLINE_DELIMITED_JSON",
      writeDisposition,
      location: ANALYTICS_CONFIG.location,
    });
    stream.on("error", reject);
    stream.on("job", (job) => job.on("complete", () => resolve()).on("error", reject));
    for (const r of projected) stream.write(Buffer.from(JSON.stringify(r) + "\n"));
    stream.end();
  });
  return projected.length;
}

export const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);
