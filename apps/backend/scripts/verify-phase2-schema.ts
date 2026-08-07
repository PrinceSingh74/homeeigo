#!/usr/bin/env bun
import prisma from "../src/lib/prisma";

const tables = ["eta_training_labels", "eta_google_snapshots", "eta_gps_tracks"];
for (const t of tables) {
  const rows = await prisma.$queryRawUnsafe<Array<{ c: number }>>(
    `SELECT COUNT(*)::int AS c FROM information_schema.tables WHERE table_schema='public' AND table_name='${t}'`,
  );
  console.log(`${t}: ${rows[0]?.c === 1 ? "EXISTS" : "MISSING"}`);
}

const idx = await prisma.$queryRawUnsafe<Array<{ tablename: string; indexname: string }>>(`
  SELECT tablename, indexname FROM pg_indexes 
  WHERE tablename IN ('eta_training_labels','eta_google_snapshots','eta_gps_tracks')
  ORDER BY tablename, indexname`);

console.log("\nINDEXES:");
for (const i of idx) console.log(`  ${i.tablename}.${i.indexname}`);

const constraints = await prisma.$queryRawUnsafe<Array<{ conname: string; contype: string; table_name: string }>>(`
  SELECT con.conname, con.contype::text, rel.relname AS table_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname IN ('eta_training_labels','eta_google_snapshots','eta_gps_tracks')
  ORDER BY rel.relname, con.conname`);

console.log("\nCONSTRAINTS:");
for (const c of constraints) console.log(`  ${c.table_name}.${c.conname} (${c.contype})`);

await prisma.$disconnect();
