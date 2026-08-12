/**
 * Validates Sentry remediation mappings (no Sentry API required).
 *   bun --env-file=.env run scripts/sentry-remediation-validate.ts
 */
import { Prisma } from "@prisma/client";
import { mapPrismaKnownError, mapDomainError, isPrismaPoolTimeout } from "../src/lib/prisma-errors";

type Case = { name: string; ok: boolean; detail?: string };
const cases: Case[] = [];

function check(name: string, ok: boolean, detail?: string) {
  cases.push({ name, ok, detail });
}

const p2024 = new Prisma.PrismaClientKnownRequestError("pool timeout", {
  code: "P2024",
  clientVersion: "test",
});
const mapped = mapPrismaKnownError(p2024);
check("P2024 → 429", mapped?.status === 429 && mapped.sentry === false);

const p2003 = new Prisma.PrismaClientKnownRequestError("fk fail", {
  code: "P2003",
  clientVersion: "test",
});
check("P2003 → 400", mapPrismaKnownError(p2003)?.status === 400);

const domain = mapDomainError("INVALID_TRANSITION:RESPONDED->EVIDENCE_PENDING");
check("INVALID_TRANSITION → 409", domain?.status === 409 && domain.sentry === false);

const ledger = mapDomainError("LEDGER_UNBALANCED");
check("LEDGER_UNBALANCED → 422", ledger?.status === 422);

check("PARSE pool timeout detect", isPrismaPoolTimeout(p2024));

const failed = cases.filter((c) => !c.ok);
console.log(JSON.stringify({ passed: cases.length - failed.length, total: cases.length, cases }, null, 2));
process.exit(failed.length ? 1 : 0);
