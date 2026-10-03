import type { Prisma } from "@prisma/client";
import prisma from "./prisma";

type WalletTxnNumberClient = Pick<Prisma.TransactionClient, "walletTransaction">;

/**
 * Booking numbers — `HOMIGO-YYYYMMDD-NNNNN` (UTC day, 5-digit daily counter; the format is a
 * contract — ETA training allowlists it). Wallet and withdrawal numbers use sequences (below).
 *
 * The counter is one row per (scope, day) in `document_sequences`, bumped atomically. These used to
 * read the day's highest number and add one, so concurrent creates minted the same number and the
 * loser failed on the unique key.
 *
 * Always autocommit on the base client, never inside the caller's transaction: a counter row locked
 * until a long booking transaction commits would serialise every booking creation in the
 * platform. The cost is a gap when the caller's transaction later rolls back — acceptable for these
 * identifiers, which are unique but not guaranteed gapless.
 */
async function nextDaily(
  scope: "booking",
  ymd: string,
  seedMax: () => Promise<number>,
): Promise<number> {
  const day = `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
  const bumped = await prisma.$queryRaw<Array<{ value: number }>>`
    UPDATE document_sequences SET value = value + 1, updated_at = NOW()
    WHERE scope = ${scope} AND day = ${day}::date
    RETURNING value`;
  if (bumped[0]) return Number(bumped[0].value);
  // First number of the day (or first since this counter shipped): continue after anything the old
  // generator already minted today, so a mid-day deploy cannot collide.
  const start = (await seedMax()) + 1;
  const rows = await prisma.$queryRaw<Array<{ value: number }>>`
    INSERT INTO document_sequences (scope, day, value) VALUES (${scope}, ${day}::date, ${start})
    ON CONFLICT (scope, day) DO UPDATE SET value = document_sequences.value + 1, updated_at = NOW()
    RETURNING value`;
  return Number(rows[0]!.value);
}

const utcYmd = () => new Date().toISOString().slice(0, 10).replace(/-/g, "");
const pad = (n: number) => String(n).padStart(5, "0");

export async function nextBookingNumber(): Promise<string> {
  const d = utcYmd();
  const prefix = `HOMIGO-${d}-`;
  const seq = await nextDaily("booking", d, async () => {
    const r = await prisma.$queryRaw<Array<{ max: number | null }>>`
      SELECT MAX(SUBSTRING(booking_number FROM '^HOMIGO-[0-9]{8}-([0-9]{5})$')::int) AS max
      FROM bookings WHERE booking_number LIKE ${prefix + "%"}`;
    return Number(r[0]?.max ?? 0);
  });
  return `${prefix}${pad(seq)}`;
}

/**
 * Wallet-transaction number from `wallet_txn_number_seq` (migration 20260919130000). Runs on the
 * caller's transaction client when given: nextval never blocks and never rolls back, so it is safe
 * inside a money transaction and needs no second connection (a second connection per transaction
 * exhausted the pool under concurrent redemptions).
 */
export async function nextWalletTxnNumber(client?: WalletTxnNumberClient): Promise<string> {
  const db = (client ?? prisma) as unknown as Pick<Prisma.TransactionClient, "$queryRaw">;
  const rows = await db.$queryRaw<Array<{ n: bigint }>>`SELECT nextval('wallet_txn_number_seq') AS n`;
  return `WXN-${utcYmd()}-${pad(Number(rows[0]!.n))}`;
}

export async function nextWithdrawalNumber(client?: Pick<Prisma.TransactionClient, "$queryRaw">): Promise<string> {
  const rows = await (client ?? prisma).$queryRaw<Array<{ n: bigint }>>`SELECT nextval('withdrawal_number_seq') AS n`;
  return `WD-${utcYmd()}-${pad(Number(rows[0]!.n))}`;
}
