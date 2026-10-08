import { decodeWithdrawKeys, encodeWithdrawKeys, withdrawKeyLedger, type WithdrawKeyStamps } from "@/lib/money-withdraw";
import { deleteSecureItem, getSecureItem, setSecureItem } from "@/lib/secure-storage";

/**
 * Keeps the withdrawal idempotency keys that are still owed an answer in the device's secure
 * storage (they are derived from bank details), so killing the app after a lost answer does not
 * turn the retry into a second withdrawal. The rules are pure and tested in `money-withdraw.ts`;
 * this file only reads and writes.
 *
 * A storage failure never blocks a withdrawal: the keys then live for the process, as before.
 */
const STORAGE_KEY = "homigo.partner.withdraw-keys.v1";

let stamps: WithdrawKeyStamps = new Map();
let restored: Promise<void> | null = null;

/** Read the stored keys into the ledger, once per process. Safe to await before every request. */
export function restoreWithdrawKeys(): Promise<void> {
  restored ??= getSecureItem(STORAGE_KEY)
    .then((text) => {
      stamps = decodeWithdrawKeys(text, withdrawKeyLedger, Date.now());
    })
    .catch(() => undefined);
  return restored;
}

/** Write the ledger as it is now. Call after a key is created and after a request is settled. */
export async function saveWithdrawKeys(): Promise<void> {
  try {
    const now = Date.now();
    for (const signature of [...stamps.keys()]) if (!withdrawKeyLedger.has(signature)) stamps.delete(signature);
    for (const signature of withdrawKeyLedger.keys()) if (!stamps.has(signature)) stamps.set(signature, now);
    if (withdrawKeyLedger.size === 0) await deleteSecureItem(STORAGE_KEY);
    else await setSecureItem(STORAGE_KEY, encodeWithdrawKeys(withdrawKeyLedger, stamps, now));
  } catch {
    /* the keys stay in memory for this process */
  }
}
