import {
  Plus,
  Smartphone,
  CreditCard,
  RefreshCw,
  Receipt,
  Gift,
  type LucideIcon,
} from "lucide-react";

// Demo wallet content is an explicit opt-in (see lib/services.ts): a build that merely is not a
// production build must not show invented content as if it were real.
//
// The demo balance, transactions ("Promo Applied"), offers with made-up promo codes, the spend
// trend and the sparkline series that used to live here are deleted: the wallet shows the server's
// ledger, offers and payments or nothing (see lib/wallet-offers, WalletRightRail).
const MOCK_BUSINESS_DATA_ENABLED = process.env.NEXT_PUBLIC_ENABLE_MOCK_BUSINESS_DATA === "true";

export type WalletQuickAction = {
  id: string;
  label: string;
  icon: LucideIcon;
  color: string;
  bg: string;
};

export const WALLET_QUICK_ACTIONS: WalletQuickAction[] = MOCK_BUSINESS_DATA_ENABLED ? [
  { id: "add", label: "Add Money", icon: Plus, color: "#059669", bg: "#ECFDF5" },
  { id: "upi", label: "UPI", icon: Smartphone, color: "#14b8a6", bg: "#F0FDFA" },
  { id: "cards", label: "Cards", icon: CreditCard, color: "#0d9488", bg: "#F0FDFA" },
  { id: "autopay", label: "Auto Pay", icon: RefreshCw, color: "#F59E0B", bg: "#FFFBEB" },
  { id: "txns", label: "Transactions", icon: Receipt, color: "#10B981", bg: "#ECFDF5" },
  { id: "invoices", label: "Invoices", icon: Receipt, color: "#10b981", bg: "#ECFDF5" },
  { id: "offers", label: "Offers", icon: Gift, color: "#D4AF37", bg: "#FFFBEB" },
] : [];

export type WalletTabId = "overview" | "transactions" | "invoices" | "payment-methods";

export const WALLET_TABS: { id: WalletTabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "transactions", label: "Transactions" },
  { id: "invoices", label: "Invoices" },
  { id: "payment-methods", label: "Payment Methods" },
];

export type WalletRecentTxn = {
  id: string;
  title: string;
  subtitle: string;
  amount: number;
  type: "credit" | "debit";
  status: "success" | "pending" | "failed";
  iconBg: string;
  iconColor: string;
};
