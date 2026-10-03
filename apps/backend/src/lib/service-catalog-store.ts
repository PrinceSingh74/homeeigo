import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import prisma from "./prisma";
import {
  hydrateCatalogConfig,
  parseCatalogConfig,
  type RelationalAddon,
  type RelationalVariant,
  type ServiceCatalogConfig,
} from "./service-catalog-config";
import type { RequirementItemInfo } from "./service-requirements";

/**
 * Relational catalogue options (service_variants / service_addons). They are written in the SAME
 * transaction as the service row that owns them, and they win over the JSON copy when present — so
 * a sync that silently failed would leave a stale price authority. Nothing here swallows errors.
 *
 * Raw SQL keeps quote/book compiling even when `prisma generate` cannot rename the query-engine
 * DLL on a locked Windows process.
 */

type Db = Pick<Prisma.TransactionClient, "$queryRaw" | "$executeRaw">;

/** Postgres "undefined_table": only a database that has not run 20260920130000 yet. */
function isMissingTable(err: unknown): boolean {
  const text = err instanceof Error ? err.message : String(err);
  return /42P01|relation "service_(variants|addons)" does not exist/.test(text);
}

export async function loadRelationalCatalog(
  serviceId: string,
  db: Db = prisma,
): Promise<{ variants: RelationalVariant[]; addons: RelationalAddon[] }> {
  try {
    const [variants, addons] = await Promise.all([
      db.$queryRaw<RelationalVariant[]>`
        SELECT
          code,
          name,
          description,
          price,
          duration_min AS "durationMin",
          audiences,
          inclusions,
          exclusions,
          requirements,
          quantity_override AS "quantityOverride",
          sort_order AS "sortOrder",
          is_active AS "isActive"
        FROM service_variants
        WHERE service_id = ${serviceId}
        ORDER BY sort_order ASC, code ASC
      `,
      db.$queryRaw<RelationalAddon[]>`
        SELECT
          code,
          name,
          description,
          price,
          duration_min AS "durationMin",
          quantity_allowed AS "quantityAllowed",
          max_quantity AS "maxQuantity",
          compatible_variant_codes AS "compatibleVariantCodes",
          requires_addon_codes AS "requiresAddonCodes",
          conflicts_with_addon_codes AS "conflictsWithAddonCodes",
          sort_order AS "sortOrder",
          is_active AS "isActive"
        FROM service_addons
        WHERE service_id = ${serviceId}
        ORDER BY sort_order ASC, code ASC
      `,
    ]);
    return { variants, addons };
  } catch (err) {
    if (isMissingTable(err)) return { variants: [], addons: [] };
    throw err;
  }
}

/** Postgres "undefined_table" for the Phase 06 tables: a database that has not run 20260922100000 yet. */
function isMissingRequirementTable(err: unknown): boolean {
  const text = err instanceof Error ? err.message : String(err);
  return /42P01|relation "service_requirement(s|_items)" does not exist/.test(text);
}

/**
 * Do the Phase 06 tables exist? Probed with to_regclass (never raises), so a database that has not run
 * the migration is not queried at all — a failed query would still be logged by Prisma on every read.
 * "present" is cached for the process; "absent" is rechecked each minute so applying the migration is
 * picked up without a restart. The 42P01 catches below stay as the backstop.
 */
let requirementTablesKnown: { present: boolean; at: number } | null = null;
async function requirementTablesPresent(db: Db): Promise<boolean> {
  if (requirementTablesKnown && (requirementTablesKnown.present || Date.now() - requirementTablesKnown.at < 60_000)) return requirementTablesKnown.present;
  const [row] = await db.$queryRaw<{ present: boolean }[]>`
    SELECT to_regclass('service_requirements') IS NOT NULL AND to_regclass('service_requirement_items') IS NOT NULL AS present
  `;
  requirementTablesKnown = { present: row?.present === true, at: Date.now() };
  return requirementTablesKnown.present;
}

type RequirementRow = {
  code: string;
  itemCode: string;
  responsibility: string;
  procurement: string | null;
  charge: string;
  isOptional: boolean;
  enforcement: string;
  verification: string;
  quantity: string | number | null;
  unit: string | null;
  quantityBasis: string | null;
  whenVariantCodes: string[];
  whenAddonCodes: string[];
  whenMinQuantity: number | null;
  customerNote: string | null;
  customerWarning: string | null;
  partnerInstructions: string | null;
  handlingNote: string | null;
  internalNote: string | null;
  sortOrder: number;
  isActive: boolean;
};

/** Row → the assignment shape of catalog_config.requirements (nulls dropped so the schema sees "unset"). */
function mapRequirementRow(r: RequirementRow): Record<string, unknown> {
  const when = {
    ...(r.whenVariantCodes.length ? { variantIds: r.whenVariantCodes } : {}),
    ...(r.whenAddonCodes.length ? { addonIds: r.whenAddonCodes } : {}),
    ...(r.whenMinQuantity != null ? { minQuantity: r.whenMinQuantity } : {}),
  };
  const opt = (k: string, v: unknown) => (v == null ? {} : { [k]: v });
  return {
    id: r.code,
    itemCode: r.itemCode,
    responsibility: r.responsibility,
    ...opt("procurement", r.procurement),
    charge: r.charge,
    optional: r.isOptional,
    enforcement: r.enforcement,
    verification: r.verification,
    ...opt("quantity", r.quantity == null ? null : Number(r.quantity)),
    ...opt("unit", r.unit),
    ...opt("quantityBasis", r.quantityBasis),
    ...(Object.keys(when).length ? { when } : {}),
    ...opt("customerNote", r.customerNote),
    ...opt("customerWarning", r.customerWarning),
    ...opt("partnerInstructions", r.partnerInstructions),
    ...opt("handlingNote", r.handlingNote),
    ...opt("internalNote", r.internalNote),
    sortOrder: r.sortOrder,
    active: r.isActive,
  };
}

/** Catalogue facts for the given item codes (one query). undefined = the catalogue table does not exist. */
export async function loadRequirementItems(codes: string[], db: Db = prisma): Promise<Record<string, RequirementItemInfo> | undefined> {
  if (!codes.length) return {};
  if (!(await requirementTablesPresent(db))) return undefined;
  try {
    const rows = await db.$queryRaw<RequirementItemInfo[]>`
      SELECT code, kind, name, customer_label AS "customerLabel", description, is_active AS "isActive"
      FROM service_requirement_items
      WHERE code = ANY(${codes}::text[])
    `;
    return Object.fromEntries(rows.map((r) => [r.code, r]));
  } catch (err) {
    if (isMissingRequirementTable(err)) return undefined;
    throw err;
  }
}

async function loadRequirementRows(serviceId: string, db: Db): Promise<Record<string, unknown>[]> {
  if (!(await requirementTablesPresent(db))) return [];
  try {
    const rows = await db.$queryRaw<RequirementRow[]>`
      SELECT
        r.code,
        i.code AS "itemCode",
        r.responsibility,
        r.procurement,
        r.charge,
        r.is_optional AS "isOptional",
        r.enforcement,
        r.verification,
        r.quantity,
        r.unit,
        r.quantity_basis AS "quantityBasis",
        r.when_variant_codes AS "whenVariantCodes",
        r.when_addon_codes AS "whenAddonCodes",
        r.when_min_quantity AS "whenMinQuantity",
        r.customer_note AS "customerNote",
        r.customer_warning AS "customerWarning",
        r.partner_instructions AS "partnerInstructions",
        r.handling_note AS "handlingNote",
        r.internal_note AS "internalNote",
        r.sort_order AS "sortOrder",
        r.is_active AS "isActive"
      FROM service_requirements r
      JOIN service_requirement_items i ON i.id = r.item_id
      WHERE r.service_id = ${serviceId}
      ORDER BY r.sort_order ASC, r.code ASC
    `;
    return rows.map(mapRequirementRow);
  } catch (err) {
    if (isMissingRequirementTable(err)) return [];
    throw err;
  }
}

export async function loadHydratedCatalog(
  service: { id: string; catalogConfig: unknown },
  db: Db = prisma,
): Promise<ServiceCatalogConfig | null> {
  const [rel, requirements] = await Promise.all([loadRelationalCatalog(service.id, db), loadRequirementRows(service.id, db)]);
  // Item facts for everything assigned — rows, or the JSON copy on a database without rows yet.
  const jsonCodes = (parseCatalogConfig(service.catalogConfig)?.requirements ?? []).map((r) => r.itemCode);
  const codes = [...new Set([...requirements.map((r) => String(r.itemCode)), ...jsonCodes])];
  const requirementItems = codes.length ? await loadRequirementItems(codes, db) : undefined;
  return hydrateCatalogConfig(service.catalogConfig, { ...rel, requirements, requirementItems });
}

/**
 * Batch form of withRequirementItems for lists: one catalogue query for every config, each config
 * gets only the items it references. Configs without requirements are returned untouched.
 */
export async function withRequirementItemsMany(cfgs: Array<ServiceCatalogConfig | null>, db: Db = prisma): Promise<Array<ServiceCatalogConfig | null>> {
  const codes = [...new Set(cfgs.flatMap((c) => (c?.requirements ?? []).map((r) => r.itemCode)))];
  if (!codes.length) return cfgs;
  const items = await loadRequirementItems(codes, db);
  if (items === undefined) return cfgs;
  return cfgs.map((c) =>
    c?.requirements?.length
      ? { ...c, requirementItems: Object.fromEntries(c.requirements.filter((r) => items[r.itemCode]).map((r) => [r.itemCode, items[r.itemCode]!])) }
      : c,
  );
}

/** Attach catalogue facts to a config that was parsed from JSON (the admin write path, before the gate). */
export async function withRequirementItems(cfg: ServiceCatalogConfig | null, db: Db = prisma): Promise<ServiceCatalogConfig | null> {
  if (!cfg?.requirements?.length) return cfg;
  const items = await loadRequirementItems([...new Set(cfg.requirements.map((r) => r.itemCode))], db);
  return items === undefined ? cfg : { ...cfg, requirementItems: items };
}

/**
 * Row id for a (service, option code) pair. A hash of both, so two services created in the same
 * instant (whose cuids share a prefix) can never collide on the primary key.
 */
export function optionRowId(prefix: "sv" | "sa" | "sr", serviceId: string, code: string): string {
  return `${prefix}_${createHash("sha256").update(`${serviceId}:${code}`).digest("hex").slice(0, 24)}`;
}

/**
 * Replace a service's option rows with the configuration being saved. Call it inside the
 * transaction that writes the service row, so the JSON document and the rows commit together or
 * not at all.
 */
export async function syncRelationalCatalog(db: Db, serviceId: string, cfg: ServiceCatalogConfig | null): Promise<void> {
  await db.$executeRaw`DELETE FROM service_variants WHERE service_id = ${serviceId}`;
  await db.$executeRaw`DELETE FROM service_addons WHERE service_id = ${serviceId}`;
  for (const [i, v] of (cfg?.variants ?? []).entries()) {
    const audiencesJson = JSON.stringify(v.audiences ?? []);
    const inclusionsJson = JSON.stringify(v.inclusions ?? []);
    const exclusionsJson = JSON.stringify(v.exclusions ?? []);
    const requirementsJson = JSON.stringify(v.requirements ?? []);
    const qty = v.quantity ? JSON.stringify(v.quantity) : null;
    await db.$executeRaw`
      INSERT INTO service_variants (
        id, service_id, code, name, description, price, duration_min,
        audiences, inclusions, exclusions, requirements, quantity_override,
        sort_order, is_active, created_at, updated_at
      ) VALUES (
        ${optionRowId("sv", serviceId, v.id)},
        ${serviceId},
        ${v.id},
        ${v.name},
        ${v.description ?? null},
        ${v.price},
        ${v.durationMin ?? null},
        ARRAY(SELECT jsonb_array_elements_text(${audiencesJson}::jsonb)),
        ARRAY(SELECT jsonb_array_elements_text(${inclusionsJson}::jsonb)),
        ARRAY(SELECT jsonb_array_elements_text(${exclusionsJson}::jsonb)),
        ARRAY(SELECT jsonb_array_elements_text(${requirementsJson}::jsonb)),
        ${qty}::jsonb,
        ${v.sortOrder ?? i},
        ${v.active !== false},
        NOW(),
        NOW()
      )
    `;
  }
  for (const [i, a] of (cfg?.addons ?? []).entries()) {
    const compatibleJson = JSON.stringify(a.compatibleVariantIds ?? []);
    const requiresJson = JSON.stringify(a.requiresAddonIds ?? []);
    const conflictsJson = JSON.stringify(a.conflictsWithAddonIds ?? []);
    await db.$executeRaw`
      INSERT INTO service_addons (
        id, service_id, code, name, description, price, duration_min,
        quantity_allowed, max_quantity, compatible_variant_codes, requires_addon_codes,
        conflicts_with_addon_codes, sort_order, is_active, created_at, updated_at
      ) VALUES (
        ${optionRowId("sa", serviceId, a.id)},
        ${serviceId},
        ${a.id},
        ${a.name},
        ${a.description ?? null},
        ${a.price},
        ${a.durationMin ?? null},
        ${a.quantityAllowed !== false},
        ${a.maxQuantity ?? null},
        ARRAY(SELECT jsonb_array_elements_text(${compatibleJson}::jsonb)),
        ARRAY(SELECT jsonb_array_elements_text(${requiresJson}::jsonb)),
        ARRAY(SELECT jsonb_array_elements_text(${conflictsJson}::jsonb)),
        ${a.sortOrder ?? i},
        ${a.active !== false},
        NOW(),
        NOW()
      )
    `;
  }
}


/**
 * Phase 06: replace a service's requirement rows with the configuration being saved — same transaction
 * as the service row. On a database without the Phase 06 tables an EMPTY list is a no-op, and a
 * non-empty list fails loudly (it could not be stored).
 */
export async function syncServiceRequirements(db: Db, serviceId: string, cfg: ServiceCatalogConfig | null): Promise<void> {
  const reqs = cfg?.requirements ?? [];
  if (!reqs.length && !(await requirementTablesPresent(db))) return;
  try {
    await db.$executeRaw`DELETE FROM service_requirements WHERE service_id = ${serviceId}`;
  } catch (err) {
    if (isMissingRequirementTable(err) && reqs.length === 0) return;
    throw err;
  }
  for (const [i, r] of reqs.entries()) {
    const variants = JSON.stringify(r.when?.variantIds ?? []);
    const addons = JSON.stringify(r.when?.addonIds ?? []);
    const inserted = await db.$executeRaw`
      INSERT INTO service_requirements (
        id, service_id, code, item_id, responsibility, procurement, charge, is_optional, enforcement,
        verification, quantity, unit, quantity_basis, when_variant_codes, when_addon_codes, when_min_quantity,
        customer_note, customer_warning, partner_instructions, handling_note, internal_note, sort_order,
        is_active, created_at, updated_at
      )
      SELECT
        ${optionRowId("sr", serviceId, r.id)}, ${serviceId}, ${r.id}, i.id, ${r.responsibility}, ${r.procurement ?? null},
        ${r.charge}, ${r.optional}, ${r.enforcement}, ${r.verification}, ${r.quantity ?? null}::numeric, ${r.unit ?? null},
        ${r.quantityBasis ?? null},
        ARRAY(SELECT jsonb_array_elements_text(${variants}::jsonb)),
        ARRAY(SELECT jsonb_array_elements_text(${addons}::jsonb)),
        ${r.when?.minQuantity ?? null}, ${r.customerNote ?? null}, ${r.customerWarning ?? null},
        ${r.partnerInstructions ?? null}, ${r.handlingNote ?? null}, ${r.internalNote ?? null},
        ${r.sortOrder ?? i}, ${r.active}, NOW(), NOW()
      FROM service_requirement_items i
      WHERE i.code = ${r.itemCode}
    `;
    if (inserted !== 1) throw new Error(`REQUIREMENT_ITEM_UNKNOWN:${r.itemCode}`);
  }
}

/**
 * Phase 10 §7: replace a service's typed execution-step rows with the plan being saved — same
 * transaction as the service row (same contract as syncServiceRequirements). On a database without
 * the table an EMPTY plan is a no-op and a non-empty plan fails loudly (it could not be stored).
 */
let executionTableKnown: { present: boolean; at: number } | null = null;
async function executionTablePresent(db: Db): Promise<boolean> {
  if (executionTableKnown && (executionTableKnown.present || Date.now() - executionTableKnown.at < 60_000)) return executionTableKnown.present;
  const [row] = await db.$queryRaw<{ present: boolean }[]>`SELECT to_regclass('service_execution_steps') IS NOT NULL AS present`;
  executionTableKnown = { present: row?.present === true, at: Date.now() };
  return executionTableKnown.present;
}
export async function syncServiceExecution(db: Db, serviceId: string, cfg: ServiceCatalogConfig | null): Promise<void> {
  const steps = cfg?.execution?.steps ?? [];
  if (!(await executionTablePresent(db))) {
    if (steps.length) throw new Error("EXECUTION_TABLE_MISSING: migration 20260924180000 not applied");
    return;
  }
  await db.$executeRaw`DELETE FROM service_execution_steps WHERE service_id = ${serviceId}`;
  for (const [i, st] of steps.entries()) {
    await db.$executeRaw`
      INSERT INTO service_execution_steps (
        id, service_id, code, title, description, kind, is_mandatory, skip_policy, evidence, estimated_minutes,
        depends_on, safety_requirement, ppe, warnings, when_variant_codes, when_addon_codes, when_min_quantity, sort_order, is_active
      ) VALUES (
        ${`se_${serviceId}_${st.id}`}, ${serviceId}, ${st.id}, ${st.title}, ${st.description ?? null}, ${st.kind}, ${st.mandatory},
        ${st.skipPolicy}, ${st.evidence}, ${st.estimatedMinutes ?? null},
        ${st.dependsOn ?? []}::text[], ${st.safetyRequirement ?? null}, ${st.ppe ?? []}::text[], ${st.warnings ?? []}::text[],
        ${st.when?.variantIds ?? []}::text[], ${st.when?.addonIds ?? []}::text[], ${st.when?.minQuantity ?? null},
        ${st.sortOrder ?? i}, ${st.active}
      )`;
  }
}
