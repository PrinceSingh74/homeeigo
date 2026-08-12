import {
  Plus,
  Smartphone,
  CreditCard,
  RefreshCw,
  Receipt,
  Gift,
  type LucideIcon,
} from "lucide-react";

const MOCK_BUSINESS_DATA_ENABLED =
  process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_ENABLE_MOCK_BUSINESS_DATA === "true";

export const WALLET_TOTAL_BALANCE = MOCK_BUSINESS_DATA_ENABLED ? 4250.75 : 0;
export const WALLET_ADDED_THIS_MONTH = MOCK_BUSINESS_DATA_ENABLED ? 850 : 0;
export const WALLET_H_COINS = MOCK_BUSINESS_DATA_ENABLED ? 320 : 0;
export const WALLET_GIFT_CARD_VALUE = MOCK_BUSINESS_DATA_ENABLED ? 850 : 0;
export const WALLET_GIFT_CARD_COUNT = MOCK_BUSINESS_DATA_ENABLED ? 2 : 0;
export const WALLET_SPEND_CHANGE_PCT = MOCK_BUSINESS_DATA_ENABLED ? 18 : 0;

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

export const WALLET_RECENT_TXNS: WalletRecentTxn[] = MOCK_BUSINESS_DATA_ENABLED ? [
  {
    id: "1",
    title: "Money added to wallet",
    subtitle: "UPI · Today, 10:24 AM",
    amount: 1000,
    type: "credit",
    status: "success",
    iconBg: "#ECFDF5",
    iconColor: "#059669",
  },
  {
    id: "2",
    title: "Home Deep Cleaning",
    subtitle: "Wallet · Yesterday",
    amount: -849,
    type: "debit",
    status: "success",
    iconBg: "#FFF7ED",
    iconColor: "#F59E0B",
  },
  {
    id: "3",
    title: "Promo Applied",
    subtitle: "CLEAN15 · 2 days ago",
    amount: 50,
    type: "credit",
    status: "success",
    iconBg: "#F0FDFA",
    iconColor: "#0d9488",
  },
  {
    id: "4",
    title: "Coins Redeemed",
    subtitle: "H-Coins · 3 days ago",
    amount: -120,
    type: "debit",
    status: "success",
    iconBg: "#FFFBEB",
    iconColor: "#D4AF37",
  },
] : [];

export type WalletOffer = {
  id: string;
  badge: string;
  title: string;
  description: string;
  code: string;
};

export const WALLET_OFFERS: WalletOffer[] = MOCK_BUSINESS_DATA_ENABLED ? [
  {
    id: "1",
    badge: "15% OFF",
    title: "Flat 15% Off",
    description: "On Deep Cleaning Services",
    code: "CLEAN15",
  },
  {
    id: "2",
    badge: "₹100 OFF",
    title: "₹100 Off AC Service",
    description: "Verified pros · Same-day",
    code: "AC100",
  },
] : [];

export const WALLET_SPARKLINE = MOCK_BUSINESS_DATA_ENABLED ? [42, 58, 45, 72, 68, 85, 78, 92, 88, 95, 82, 100] : [];
