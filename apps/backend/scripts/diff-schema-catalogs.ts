/**
 * Schema drift: EXPECTED (a database built only from `prisma/migrations`) vs ACTUAL (a live database).
 *
 * The contract gate proves the client can read the live schema; the authority verifier checks a
 * named list of protected objects. Neither says the two databases are the same. This compares the
 * catalogs object by object — tables, columns (type + nullability + default), indexes (by definition),
 * constraints (by definition), triggers, sequences, enum values — and reports MISSING (expected, not
 * in actual), EXTRA (in actual, not expected) and DIFFERENT.
 *
 * Anything EXTRA exists in the live database with no migration that creates it: the definition of a
 * `db push`-only dependency. Anything MISSING is a migration that did not take effect on live.
 *
 *   bun run scripts/diff-schema-catalogs.ts --expected "<url of a migrations-only rebuild>" --actual "<live url>"
 *
 * Read-only on both. Exits 1 on any unexplained difference.
 */
import { PrismaClient } from "@prisma/client";

const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const expectedUrl = arg("expected");
const actualUrl = arg("actual");
if (!expectedUrl || !actualUrl) {
  console.error("REFUSING: --expected and --actual are both required.");
  process.exit(2);
}

type Catalog = Map<string, Map<string, string>>;

/**
 * Live-only objects that are KNOWN, explained, and deliberately not in migrations. Each is printed as
 * EXPLAINED rather than counted, so the exit code answers "is there anything new". An entry here is
 * a documented operator decision, not a way to make a difference go away: the reason is what ships.
 */
const EXPLAINED: Array<{ kind: string; match: RegExp; reason: string }> = [
  {
    kind: "table|column|index|constraint|sequence",
    match: /^forensic_recovery_log(\.|_|$)/,
    reason:
      "DR evidence table from the 2026-09-16 scheduled_jobs incident; docs/enterprise-2035-migration-authority.md §6 records it as an operator decision (export then drop, or keep). Never add to migrations.",
  },
  {
    kind: "function",
    match: /^sync_money_sim_paise$/,
    reason:
      "Residue of scripts/money-simulation.sql (a simulation harness); no trigger references it on live. DEPRECATE_CANDIDATE — dropping it is an operator action, not a migration.",
  },
];
const explainedBy = (kind: string, key: string) =>
  EXPLAINED.find((e) => e.kind.split("|").includes(kind) && e.match.test(key));

/**
 * Column defaults are compared after normalisation. Postgres stores the expression text it was
 * given, so `now()` and `CURRENT_TIMESTAMP`, and `'{}'::text[]` and `ARRAY[]::text[]`, are the same
 * default spelled two ways. The first run of this tool reported five such columns as DIFFERENT.
 */
const normaliseDefault = (d: string) =>
  d
    .replace(/default=CURRENT_TIMESTAMP$/i, "default=now()")
    .replace(/default='\{\}'::(\w+)\[\]$/, "default=ARRAY[]::$1[]");

async function snapshot(url: string): Promise<{ db: string; cat: Catalog }> {
  const p = new PrismaClient({ datasources: { db: { url } } });
  const [{ db }] = await p.$queryRawUnsafe<{ db: string }[]>("SELECT current_database() AS db");
  const cat: Catalog = new Map();
  const put = (kind: string, key: string, def: string) => {
    if (!cat.has(kind)) cat.set(kind, new Map());
    cat.get(kind)!.set(key, def);
  };

  for (const r of await p.$queryRawUnsafe<{ t: string }[]>(
    `SELECT table_name t FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`,
  )) put("table", r.t, "");

  for (const r of await p.$queryRawUnsafe<{ k: string; d: string }[]>(
    // Base tables only: an extension view (pg_stat_statements) is not schema the migrations own.
    `SELECT c.table_name||'.'||c.column_name k,
            c.data_type||'|'||c.udt_name||'|null='||c.is_nullable||'|default='||coalesce(c.column_default,'') d
     FROM information_schema.columns c
     JOIN information_schema.tables t ON t.table_schema=c.table_schema AND t.table_name=c.table_name
     WHERE c.table_schema='public' AND t.table_type='BASE TABLE'`,
  )) put("column", r.k, normaliseDefault(r.d));

  for (const r of await p.$queryRawUnsafe<{ k: string; d: string }[]>(
    `SELECT indexname k, regexp_replace(indexdef, ' ON public\\.', ' ON ') d FROM pg_indexes WHERE schemaname='public'`,
  )) put("index", r.k, r.d);

  for (const r of await p.$queryRawUnsafe<{ k: string; d: string }[]>(
    `SELECT c.conrelid::regclass::text||'.'||c.conname k, pg_get_constraintdef(c.oid) d
     FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public'`,
  )) put("constraint", r.k, r.d);

  for (const r of await p.$queryRawUnsafe<{ k: string; d: string }[]>(
    `SELECT t.tgrelid::regclass::text||'.'||t.tgname k, pg_get_triggerdef(t.oid) d
     FROM pg_trigger t WHERE NOT t.tgisinternal`,
  )) put("trigger", r.k, r.d);

  for (const r of await p.$queryRawUnsafe<{ k: string }[]>(
    `SELECT sequence_name k FROM information_schema.sequences WHERE sequence_schema='public'`,
  )) put("sequence", r.k, "");

  for (const r of await p.$queryRawUnsafe<{ k: string; d: string }[]>(
    `SELECT t.typname k, string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) d
     FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid GROUP BY t.typname`,
  )) put("enum", r.k, r.d);

  for (const r of await p.$queryRawUnsafe<{ k: string; d: string }[]>(
    // Carriage returns and trailing whitespace are stripped before hashing: migration files are
    // CRLF on a Windows checkout, so a function created by `migrate deploy` there differs byte-wise
    // from the same function created from an LF checkout. The first run of this tool reported all
    // 15 money-trigger functions as DIFFERENT for exactly that reason, and nothing else.
    `SELECT p.proname k,
            md5(regexp_replace(regexp_replace(pg_get_functiondef(p.oid), E'\r', '', 'g'), E'[ \t]+\n', E'\n', 'g')) d
     FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.prokind='f'
       -- Functions an EXTENSION owns (pg_stat_statements & co.) arrive with the extension, not a migration.
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid=p.oid AND d.deptype='e')`,
  )) put("function", r.k, r.d);

  await p.$disconnect();
  return { db, cat };
}

const [exp, act] = await Promise.all([snapshot(expectedUrl), snapshot(actualUrl)]);
console.log(`[schema-diff] EXPECTED ${exp.db}  vs  ACTUAL ${act.db}\n`);

let problems = 0;
const kinds = ["table", "column", "index", "constraint", "trigger", "sequence", "enum", "function"];
for (const kind of kinds) {
  const e = exp.cat.get(kind) ?? new Map();
  const a = act.cat.get(kind) ?? new Map();
  const missing = [...e.keys()].filter((k) => !a.has(k)).sort();
  const extraAll = [...a.keys()].filter((k) => !e.has(k)).sort();
  const explained = extraAll.filter((k) => explainedBy(kind, k));
  const extra = extraAll.filter((k) => !explainedBy(kind, k));
  const different = [...e.keys()].filter((k) => a.has(k) && a.get(k) !== e.get(k)).sort();
  problems += missing.length + extra.length + different.length;
  console.log(
    `  ${kind.padEnd(10)} expected=${String(e.size).padStart(5)} actual=${String(a.size).padStart(5)}  ` +
      `MISSING=${missing.length} EXTRA=${extra.length} DIFFERENT=${different.length}` +
      (explained.length ? ` EXPLAINED=${explained.length}` : ""),
  );
  for (const k of explained) console.log(`      EXPLAINED ${k} — ${explainedBy(kind, k)!.reason}`);
  const show = (label: string, list: string[], withDefs = false) => {
    for (const k of list.slice(0, 12)) {
      console.log(`      ${label} ${k}`);
      if (withDefs) {
        console.log(`          expected: ${String(e.get(k)).slice(0, 180)}`);
        console.log(`          actual:   ${String(a.get(k)).slice(0, 180)}`);
      }
    }
    if (list.length > 12) console.log(`      ... and ${list.length - 12} more ${label}`);
  };
  show("MISSING  ", missing);
  show("EXTRA    ", extra);
  show("DIFFERENT", different, true);
}
console.log(problems ? `\n[schema-diff] ${problems} difference(s)` : `\n[schema-diff] IDENTICAL`);
process.exit(problems ? 1 : 0);
