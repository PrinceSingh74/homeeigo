import type { LucideIcon } from "lucide-react-native";
import {
  Wallet,
  Smartphone,
  CreditCard,
  History,
  Percent,
  Send,
  Gift,
} from "lucide-react-native";

// NOTE: wallet balance + transactions are sourced exclusively from the backend
// (useWalletBalanceQuery / useWalletTransactionsQuery). The only items kept here
// are the static quick-action chips (pure UI) and the INR formatter.

export type WalletQuickAction = {
  id: string;
  label: string;
  icon: LucideIcon;
  color: string;
  bg: string;
  badge?: string;
};

export const WALLET_QUICK_ACTIONS: WalletQuickAction[] = [
  { id: "add", label: "Add Money", icon: Wallet, color: "#2563EB", bg: "#EFF6FF" },
  { id: "send", label: "Send Money", icon: Send, color: "#7C3AED", bg: "#F5F3FF" },
  { id: "gifts", label: "Gift Cards", icon: Gift, color: "#C026D3", bg: "#FDF4FF" },
  { id: "upi", label: "UPI", icon: Smartphone, color: "#06B6D4", bg: "#ECFEFF", badge: "New" },
  { id: "cards", label: "Cards", icon: CreditCard, color: "#2563EB", bg: "#EFF6FF" },
  {
    id: "history",
    label: "Transaction History",
    icon: History,
    color: "#7C3AED",
    bg: "#F5F3FF",
  },
  { id: "offers", label: "Offers", icon: Percent, color: "#F59E0B", bg: "#FFFBEB" },
];

export function formatINR(amount: number, decimals = 2): string {
  return amount.toLocaleString("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Placeholder until premium subscription expiry is returned by the API. */
export const WALLET_PREMIUM_EXPIRY = "—";
