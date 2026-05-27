import type { LucideIcon } from "lucide-react-native";
import {
  Wallet,
  Smartphone,
  CreditCard,
  History,
  Percent,
} from "lucide-react-native";

export const WALLET_BALANCE = 2450.75;
export const WALLET_ADDED_MONTH = 350;
export const WALLET_H_COINS = 320;
export const WALLET_GIFT_VALUE = 850;
export const WALLET_GIFT_COUNT = 2;
export const WALLET_PREMIUM_EXPIRY = "12 Dec 2025";

export const WALLET_USER = {
  name: "Arjun Kumar",
  avatar:
    "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=120&h=120&fit=crop&q=80",
};

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

export type WalletTxn = {
  id: string;
  title: string;
  subtitle: string;
  amount: number;
  type: "credit" | "debit";
  iconBg: string;
  iconColor: string;
};

export const WALLET_TXNS: WalletTxn[] = [
  {
    id: "1",
    title: "Money added to wallet",
    subtitle: "Via UPI • 20 May 2025, 10:30 AM",
    amount: 1000,
    type: "credit",
    iconBg: "#EFF6FF",
    iconColor: "#2563EB",
  },
  {
    id: "2",
    title: "Home Deep Cleaning",
    subtitle: "Service Payment • 19 May 2025, 2:15 PM",
    amount: -849,
    type: "debit",
    iconBg: "#FFF7ED",
    iconColor: "#F59E0B",
  },
  {
    id: "3",
    title: "Promo Applied",
    subtitle: "HOMIGO50 • 18 May 2025, 6:00 PM",
    amount: 50,
    type: "credit",
    iconBg: "#F5F3FF",
    iconColor: "#7C3AED",
  },
  {
    id: "4",
    title: "Coins Redeemed",
    subtitle: "Insta Booking Discount • 17 May 2025",
    amount: -120,
    type: "debit",
    iconBg: "#FFFBEB",
    iconColor: "#D4AF37",
  },
];

export function formatINR(amount: number, decimals = 2): string {
  return amount.toLocaleString("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}
