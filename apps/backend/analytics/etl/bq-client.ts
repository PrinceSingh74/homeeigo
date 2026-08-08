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

/**
 * Idempotent warehouse write: load to a staging table, then MERGE on a business key.
 *
 * `loadRows` alone is append-only, so a re-sync of the same source record duplicates it.
 * For datasets that must hold exactly one canonical row per business key — ETA training
 * labels above all — this replaces the append with an upsert.
 *
 * Staging is truncated per call, so a crashed run leaves no partial state behind: the
 * next call overwrites it before the MERGE reads it.
 */
export async function mergeRows(
  layer: keyof typeof BQ_DATASETS,
  tableId: string,
  keyColumn: string,
  rows: Record<string, unknown>[],
): Promise<number> {
  if (rows.length === 0) return 0;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(keyColumn)) {
    throw new Error(`Invalid merge key column: ${keyColumn}`);
  }

  const dataset = BQ_DATASETS[layer];
  const stagingId = `${tableId}_stg`;

  // WRITE_TRUNCATE so staging holds only this batch.
  await loadRows(layer, stagingId, rows, "WRITE_TRUNCATE");

  // Column list comes from the target's deployed schema, so a column present in staging
  // but not yet in the target cannot break the MERGE.
  const [meta] = await getBigQuery().dataset(dataset).table(tableId).getMetadata();
  const targetCols: string[] = (meta.schema?.fields ?? []).map((f: { name: string }) => f.name);
  const [stgMeta] = await getBigQuery().dataset(dataset).table(stagingId).getMetadata();
  const stgCols = new Set<string>((stgMeta.schema?.fields ?? []).map((f: { name: string }) => f.name));
  const cols = targetCols.filter((c) => stgCols.has(c));
  if (!cols.includes(keyColumn)) {
    throw new Error(`Merge key ${keyColumn} missing from ${dataset}.${tableId} staging payload`);
  }

  const updates = cols.filter((c) => c !== keyColumn).map((c) => `T.${c} = S.${c}`).join(", ");
  const insertCols = cols.join(", ");
  const insertVals = cols.map((c) => `S.${c}`).join(", ");

  const sql = `
    MERGE \`${ANALYTICS_CONFIG.projectId}.${dataset}.${tableId}\` T
    USING (
      SELECT * EXCEPT(__rn) FROM (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY ${keyColumn} ORDER BY ${keyColumn}) AS __rn
        FROM \`${ANALYTICS_CONFIG.projectId}.${dataset}.${stagingId}\`
      ) WHERE __rn = 1
    ) S
    ON T.${keyColumn} = S.${keyColumn}
    ${updates ? `WHEN MATCHED THEN UPDATE SET ${updates}` : ""}
    WHEN NOT MATCHED THEN INSERT (${insertCols}) VALUES (${insertVals})
  `;

  await getBigQuery().query({ query: sql, location: ANALYTICS_CONFIG.location });
  return rows.length;
}

export const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);
