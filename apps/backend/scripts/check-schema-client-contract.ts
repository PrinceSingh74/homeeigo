/**
 * NO_SCHEMA_CLIENT_DRIFT — do the Prisma schema, the migration history, the generated client and the
 * live database all agree?
 *
 * Pass 4 established why this has to exist as its own gate. `verify-migration-authority.ts` probed
 * the client with narrow `select` lists, which ask Postgres only for the columns they name, so a
 * column the client declares and the database lacks was never requested and never errored. It
 * printed 29/29 PASS against a database where `prisma.user.findFirst()` throws P2022.
 *
 * The lesson generalises past that one column: a check that names the things it knows about can only
 * ever find the things it knows about. So this derives its expectations from `schema.prisma` itself —
 * every scalar field on every model — and compares them against `information_schema`. A field added
 * to the schema tomorrow is covered without anyone remembering to add it here.
 *
 *   bun run scripts/check-schema-client-contract.ts --url "<postgres url>"
 *
 * `--url` is mandatory: `prisma.config.ts` loads dotenv, and a verification script that silently
 * inherits DATABASE_URL is how a check ends up reporting on the wrong database.
 *
 * Read-only. Executes SELECTs and introspection only.
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const argIdx = process.argv.indexOf("--url");
const url = argIdx >= 0 ? process.argv[argIdx + 1] : undefined;
if (!url) {
  console.error("REFUSING: --url is required. This script never reads DATABASE_URL from the environment.");
  process.exit(2);
}

const prisma = new PrismaClient({ datasources: { db: { url } } });
const failures: string[] = [];
const notes: string[] = [];

/** Prisma scalar types that map to a real column, and the Postgres types they may land on. */
const SCALARS = new Set(["String", "Boolean", "Int", "BigInt", "Float", "Decimal", "DateTime", "Json", "Bytes"]);

type Field = { name: string; column: string; type: string; optional: boolean; isEnum: boolean; isList: boolean };
type Model = { name: string; table: string; fields: Field[] };

/**
 * Parse `schema.prisma` rather than importing Prisma's DMMF.
 *
 * The DMMF describes the client that was *generated*, which on a stale build is a different thing
 * from the schema on disk — and telling those two apart is half the point of this gate.
 */
function parseSchema(text: string): { models: Model[]; enums: Set<string>; enumTable: Map<string, string> } {
  const enums = new Set<string>();
  /**
   * Prisma enum name → the Postgres type name it actually creates.
   *
   * 17 of the 151 enums carry `@@map("snake_case")`, so looking the Prisma name up in `pg_type`
   * reports them all as missing. The first run of this gate did exactly that: 18 "missing enum
   * type" failures, 17 of them noise, burying the one that was real (`DataOrigin`). A gate with a
   * 94% false-positive rate does not get fixed, it gets ignored — which is the failure mode this
   * whole pass exists to find.
   */
  const enumTable = new Map<string, string>();
  for (const m of text.matchAll(/^enum\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    const name = m[1]!;
    enums.add(name);
    enumTable.set(name, m[2]!.match(/@@map\("([^"]+)"\)/)?.[1] ?? name);
  }

  const models: Model[] = [];
  const blocks = text.split(/^model\s+/m).slice(1);
  for (const block of blocks) {
    const name = block.split(/\s/)[0]!;
    const body = block.slice(0, block.indexOf("\n}"));
    const tableMatch = body.match(/@@map\("([^"]+)"\)/);
    const fields: Field[] = [];
    for (const raw of body.split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("//") || line.startsWith("@@") || line.startsWith("{")) continue;
      const m = line.match(/^(\w+)\s+(\w+)(\[\])?(\?)?/);
      if (!m) continue;
      const [, fieldName, fieldType, list, optional] = m;
      if (!SCALARS.has(fieldType!) && !enums.has(fieldType!)) continue; // a relation, not a column
      const colMatch = line.match(/@map\("([^"]+)"\)/);
      fields.push({
        name: fieldName!,
        column: colMatch?.[1] ?? fieldName!,
        type: fieldType!,
        optional: Boolean(optional),
        isEnum: enums.has(fieldType!),
        isList: Boolean(list),
      });
    }
    models.push({ name, table: tableMatch?.[1] ?? name, fields });
  }
  return { models, enums, enumTable };
}

async function main() {
  const [{ current_database: db }] = await prisma.$queryRawUnsafe<{ current_database: string }[]>(
    "SELECT current_database()",
  );
  console.log(`[schema-client-contract] target database: ${db}\n`);

  const schemaText = readFileSync(join(import.meta.dir, "..", "prisma", "schema.prisma"), "utf8");
  const { models, enums, enumTable } = parseSchema(schemaText);

  // ── 1. Every column the schema declares exists in the database ────────────────────────────────
  const liveCols = await prisma.$queryRawUnsafe<
    Array<{ table_name: string; column_name: string; is_nullable: string; udt_name: string }>
  >(
    `SELECT table_name, column_name, is_nullable, udt_name
     FROM information_schema.columns WHERE table_schema = 'public'`,
  );
  const colKey = (t: string, c: string) => `${t}.${c}`;
  const live = new Map(liveCols.map((r) => [colKey(r.table_name, r.column_name), r]));
  const liveTables = new Set(liveCols.map((r) => r.table_name));

  let missingColumns = 0;
  let nullabilityMismatch = 0;
  let checkedColumns = 0;
  let skippedTables = 0;

  for (const model of models) {
    if (!liveTables.has(model.table)) {
      // A model with no table at all is a different failure (and a louder one); report and move on.
      skippedTables++;
      failures.push(`table missing entirely: ${model.table} (model ${model.name})`);
      continue;
    }
    for (const f of model.fields) {
      if (f.isList && !f.isEnum) continue; // scalar lists are rare and map differently
      checkedColumns++;
      const found = live.get(colKey(model.table, f.column));
      if (!found) {
        missingColumns++;
        failures.push(`column missing: ${model.table}.${f.column} (${model.name}.${f.name}: ${f.type})`);
        continue;
      }
      // A schema field that is required while the column is nullable will fail at read time the
      // first time a NULL is encountered — silently correct until it is not.
      const liveNullable = found.is_nullable === "YES";
      if (!f.optional && liveNullable && !f.isList) {
        nullabilityMismatch++;
        notes.push(`nullability: ${model.table}.${f.column} is NULL-able in the database but required in the schema`);
      }
    }
  }

  console.log(`  models: ${models.length}   columns checked: ${checkedColumns}`);
  console.log(`  columns missing from the database: ${missingColumns}`);
  console.log(`  tables missing from the database:  ${skippedTables}`);
  console.log(`  nullability notes:                 ${nullabilityMismatch}`);

  // ── 2. Every enum the schema declares exists, with all its values ─────────────────────────────
  const liveEnums = await prisma.$queryRawUnsafe<Array<{ typname: string; enumlabel: string }>>(
    `SELECT t.typname, e.enumlabel FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid`,
  );
  const liveEnumValues = new Map<string, Set<string>>();
  for (const r of liveEnums) {
    if (!liveEnumValues.has(r.typname)) liveEnumValues.set(r.typname, new Set());
    liveEnumValues.get(r.typname)!.add(r.enumlabel);
  }
  // Only enums actually used by a column matter; an unused enum declaration is harmless.
  const usedEnums = new Set(models.flatMap((m) => m.fields.filter((f) => f.isEnum).map((f) => f.type)));
  let missingEnums = 0;
  let missingEnumValues = 0;
  for (const name of usedEnums) {
    const pgType = enumTable.get(name) ?? name;
    const liveVals = liveEnumValues.get(pgType);
    if (!liveVals) {
      missingEnums++;
      failures.push(`enum type missing: ${name}${pgType !== name ? ` (pg type "${pgType}")` : ""}`);
      continue;
    }
    const declared = [...schemaText.matchAll(new RegExp(`enum\\s+${name}\\s*\\{([^}]*)\\}`, "g"))]
      // `@@map(...)` and comments are not enum values. The first run reported ten `@@map` lines as
      // "missing values" — the same noise problem one level down from the enum-name one above.
      .flatMap((m) =>
        m[1]!
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith("//") && !l.startsWith("@@")),
      )
      .map((l) => l.split(/\s/)[0]!);
    for (const v of declared) {
      if (!liveVals.has(v)) {
        missingEnumValues++;
        failures.push(`enum value missing: ${name}.${v}`);
      }
    }
  }
  console.log(`  enums in use: ${usedEnums.size}   missing types: ${missingEnums}   missing values: ${missingEnumValues}`);

  // ── 3. Every migration directory has been applied ─────────────────────────────────────────────
  const { readdirSync, existsSync } = await import("node:fs");
  const migDir = join(import.meta.dir, "..", "prisma", "migrations");
  const onDisk = existsSync(migDir)
    ? readdirSync(migDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()
    : [];
  //
  // `homigo_test` is built by `scripts/setup-test-db.ts` from raw SQL and has no
  // `_prisma_migrations` table at all. Crashing there would make this gate unusable against the one
  // database where the contract can be proven both ways — and a gate that cannot be run on the
  // obvious target is a gate people route around. Report the condition loudly and carry on with the
  // checks that remain valid, because schema-vs-client is exactly as meaningful without it.
  const [{ present: historyPresent }] = await prisma.$queryRawUnsafe<Array<{ present: boolean }>>(
    `SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS present`,
  );
  if (!historyPresent) {
    console.log(`  migrations on disk: ${onDisk.length}   history table: ABSENT — migration check skipped`);
    notes.push(
      "no _prisma_migrations table: this database was not built by `migrate deploy`, so migration " +
        "authority cannot be judged here. The schema/client checks above still apply in full.",
    );
  } else {
    const applied = await prisma.$queryRawUnsafe<Array<{ migration_name: string }>>(
      `SELECT DISTINCT migration_name FROM _prisma_migrations`,
    );
    const appliedNames = new Set(applied.map((r) => r.migration_name));
    const neverApplied = onDisk.filter((d) => !appliedNames.has(d));
    console.log(`  migrations on disk: ${onDisk.length}   never applied: ${neverApplied.length}`);
    for (const m of neverApplied) failures.push(`migration never applied: ${m}`);
  }

  // ── 4. The generated client can actually read each model ──────────────────────────────────────
  //
  // A BARE find, never a narrow select. The bare form asks for every scalar the generated client
  // believes exists, which is precisely the claim under test. `take: 1` keeps it cheap, and a table
  // with no rows still round-trips the column list through Postgres, so an empty table still proves
  // the contract.
  const client = prisma as unknown as Record<string, { findMany?: (a: unknown) => Promise<unknown> }>;
  let probed = 0;
  let probeFailures = 0;
  for (const model of models) {
    const key = model.name.charAt(0).toLowerCase() + model.name.slice(1);
    const delegate = client[key];
    if (!delegate?.findMany) continue;
    probed++;
    try {
      await delegate.findMany({ take: 1 });
    } catch (e) {
      const err = e as { message?: string; code?: string };
      const detail = (err.message ?? "").split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "unknown";
      probeFailures++;
      failures.push(`client cannot read ${model.name}: ${err.code ? `${err.code} ` : ""}${detail.slice(0, 120)}`);
    }
  }
  console.log(`  models probed with a bare find: ${probed}   failures: ${probeFailures}`);

  // ── Verdict ───────────────────────────────────────────────────────────────────────────────────
  if (notes.length) {
    console.log(`\nNOTES (not failures):`);
    for (const n of notes.slice(0, 10)) console.log(`   ${n}`);
    if (notes.length > 10) console.log(`   ... and ${notes.length - 10} more`);
  }
  if (failures.length) {
    console.log(`\nDRIFT (${failures.length}):`);
    for (const f of failures.slice(0, 40)) console.log(`   ${f}`);
    if (failures.length > 40) console.log(`   ... and ${failures.length - 40} more`);
    console.log(`\n[schema-client-contract] FAIL — SCHEMA_CLIENT_DRIFT`);
  } else {
    console.log(`\n[schema-client-contract] PASS — NO_SCHEMA_CLIENT_DRIFT`);
  }

  await prisma.$disconnect();
  process.exit(failures.length ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
