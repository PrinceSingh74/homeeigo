// Wallet number formatting. The demo balance and transaction list that used to live here
// (named professionals, a fixed balance) had no importer and were deleted, along with the
// switch that turned them on for every non-production build: the wallet shows the server's ledger.

export function formatWalletAmount(amount: number): string {
  const sign = amount >= 0 ? "+" : "";
  return `${sign}₹${Math.abs(amount).toLocaleString("en-IN")}`;
}

export function formatBalance(amount: number): string {
  return amount.toLocaleString("en-IN");
}
