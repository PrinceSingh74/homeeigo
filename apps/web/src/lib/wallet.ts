export type WalletTxnType = "credit" | "debit";

export type WalletTransaction = {
  id: string;
  label: string;
  amount: number;
  type: WalletTxnType;
  time: string;
  category?: "booking" | "cashback" | "topup" | "refund";
};

export const WALLET_BALANCE = 2450;

export const WALLET_TRANSACTIONS: WalletTransaction[] = [
  {
    id: "1",
    label: "AC Service · Rahul K.",
    amount: -499,
    type: "debit",
    time: "Today",
    category: "booking",
  },
  {
    id: "2",
    label: "Cashback · Premium",
    amount: 50,
    type: "credit",
    time: "Yesterday",
    category: "cashback",
  },
  {
    id: "3",
    label: "Wallet top-up",
    amount: 2000,
    type: "credit",
    time: "3 days ago",
    category: "topup",
  },
  {
    id: "4",
    label: "Deep cleaning · Priya M.",
    amount: -899,
    type: "debit",
    time: "5 days ago",
    category: "booking",
  },
  {
    id: "5",
    label: "Referral bonus",
    amount: 100,
    type: "credit",
    time: "1 week ago",
    category: "cashback",
  },
];

export type WalletTxnFilter = "all" | "credit" | "debit";

export function formatWalletAmount(amount: number): string {
  const sign = amount >= 0 ? "+" : "";
  return `${sign}₹${Math.abs(amount).toLocaleString("en-IN")}`;
}

export function formatBalance(amount: number): string {
  return amount.toLocaleString("en-IN");
}

export function filterWalletTransactions(
  txns: WalletTransaction[],
  filter: WalletTxnFilter,
): WalletTransaction[] {
  if (filter === "all") return txns;
  return txns.filter((t) => t.type === filter);
}

export function walletTxnStats(txns: WalletTransaction[]) {
  const credits = txns.filter((t) => t.type === "credit");
  const debits = txns.filter((t) => t.type === "debit");
  return {
    all: txns.length,
    credit: credits.length,
    debit: debits.length,
    cashbackEarned: credits
      .filter((t) => t.category === "cashback")
      .reduce((s, t) => s + t.amount, 0),
    spent: Math.abs(debits.reduce((s, t) => s + t.amount, 0)),
  };
}
