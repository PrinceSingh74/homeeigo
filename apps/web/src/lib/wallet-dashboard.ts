import {
  Plus,
  Smartphone,
  CreditCard,
  RefreshCw,
  Receipt,
  Gift,
  Lock,
  Headphones,
  type LucideIcon,
} from "lucide-react";

export const WALLET_TOTAL_BALANCE = 4250.75;
export const WALLET_ADDED_THIS_MONTH = 850;
export const WALLET_H_COINS = 320;
export const WALLET_GIFT_CARD_VALUE = 850;
export const WALLET_GIFT_CARD_COUNT = 2;
export const WALLET_MONTHLY_SPEND = 2849;
export const WALLET_SPEND_CHANGE_PCT = 18;

export type WalletQuickAction = {
  id: string;
  label: string;
  icon: LucideIcon;
  color: string;
  bg: string;
};

export const WALLET_QUICK_ACTIONS: WalletQuickAction[] = [
  { id: "add", label: "Add Money", icon: Plus, color: "#2563EB", bg: "#EFF6FF" },
  { id: "upi", label: "UPI", icon: Smartphone, color: "#06B6D4", bg: "#ECFEFF" },
  { id: "cards", label: "Cards", icon: CreditCard, color: "#7C3AED", bg: "#F5F3FF" },
  { id: "autopay", label: "Auto Pay", icon: RefreshCw, color: "#F59E0B", bg: "#FFFBEB" },
  { id: "txns", label: "Transactions", icon: Receipt, color: "#10B981", bg: "#ECFDF5" },
  { id: "invoices", label: "Invoices", icon: Receipt, color: "#EC4899", bg: "#FDF2F8" },
  { id: "offers", label: "Offers", icon: Gift, color: "#D4AF37", bg: "#FFFBEB" },
];

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

export const WALLET_RECENT_TXNS: WalletRecentTxn[] = [
  {
    id: "1",
    title: "Money added to wallet",
    subtitle: "UPI · Today, 10:24 AM",
    amount: 1000,
    type: "credit",
    status: "success",
    iconBg: "#EFF6FF",
    iconColor: "#2563EB",
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
    iconBg: "#F5F3FF",
    iconColor: "#7C3AED",
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
];

export const WALLET_BREAKDOWN = [
  { label: "Wallet Balance", value: 2450.75, color: "#7C3AED", pct: 58 },
  { label: "H-Coins Value", value: 850, color: "#F59E0B", pct: 20 },
  { label: "Gift Cards", value: 950, color: "#06B6D4", pct: 22 },
];

export type WalletOffer = {
  id: string;
  badge: string;
  title: string;
  description: string;
  code: string;
};

export const WALLET_OFFERS: WalletOffer[] = [
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
];

export type WalletInvoice = {
  id: string;
  amount: number;
  date: string;
  status: "paid" | "pending";
};

export const WALLET_INVOICES: WalletInvoice[] = [
  { id: "INV-2841", amount: 849, date: "May 18, 2026", status: "paid" },
  { id: "INV-2799", amount: 499, date: "May 12, 2026", status: "paid" },
  { id: "INV-2750", amount: 1200, date: "May 5, 2026", status: "paid" },
];

export type WalletPaymentMethod = {
  id: string;
  type: "card" | "upi" | "bank";
  label: string;
  detail: string;
  primary?: boolean;
};

export const WALLET_PAYMENT_METHODS: WalletPaymentMethod[] = [
  { id: "1", type: "card", label: "HDFC Debit", detail: "•••• 4821", primary: true },
  { id: "2", type: "upi", label: "UPI", detail: "arjun@okaxis" },
  { id: "3", type: "bank", label: "Bank Account", detail: "HDFC · •••• 9024" },
];

export const WALLET_SPARKLINE = [42, 58, 45, 72, 68, 85, 78, 92, 88, 95, 82, 100];

export const WALLET_TRUST_CARDS = [
  { icon: Lock, title: "Safe & Secure", text: "Bank level security", bg: "#ECFDF5", color: "#10B981" },
  {
    icon: RefreshCw,
    title: "Instant Refunds",
    text: "Hassle free refunds",
    bg: "#EFF6FF",
    color: "#2563EB",
  },
  {
    icon: CreditCard,
    title: "Multiple Payment Options",
    text: "UPI, Cards, Netbanking & more",
    bg: "#F5F3FF",
    color: "#7C3AED",
  },
  {
    icon: Headphones,
    title: "24/7 Support",
    text: "We are here to help",
    bg: "#FFF7ED",
    color: "#F59E0B",
  },
];

export const WALLET_USER = {
  name: "Arjun Kumar",
  status: "Premium Member",
  avatar:
    "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=120&h=120&fit=crop&q=80",
};
