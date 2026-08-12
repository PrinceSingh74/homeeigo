import prisma from "../src/lib/prisma";
const rows = await prisma.$queryRawUnsafe<any[]>(`
  SELECT state, count(*)::int AS n
  FROM pg_stat_activity WHERE datname=current_database()
  GROUP BY state ORDER BY n DESC`);
let total=0, idle=0;
for (const r of rows){ total+=r.n; if(String(r.state).startsWith("idle")) idle+=r.n; console.log(`${String(r.state).padEnd(22)} ${r.n}`);}
const longtx = await prisma.$queryRawUnsafe<any[]>(`SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND state='idle in transaction' AND now()-state_change>interval '30 seconds'`);
console.log(`\nTOTAL=${total} IDLE=${idle} ACTIVE=${total-idle} long_idle_in_txn=${longtx[0].n}`);
console.log("pool cap (this process):", new URL(process.env.DATABASE_URL!).searchParams.get("connection_limit") ?? "(set by resolver=8 dev)");
process.exit(0);
