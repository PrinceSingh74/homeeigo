import {
  CalendarDays,
  Home,
  LayoutGrid,
  Sparkles,
  User,
  Wallet,
  type LucideIcon,
} from "lucide-react";

export type MainNavItem = {
  href: string;
  label: string;
  /** Shorter label for compact mobile bottom nav */
  shortLabel?: string;
  icon: LucideIcon;
  badge?: string;
};

/** Primary site navigation — same order on desktop header and mobile bottom bar */
export const MAIN_NAV_ITEMS: MainNavItem[] = [
  { href: "/", label: "Home", icon: Home },
  { href: "/services", label: "Services", icon: LayoutGrid },
  {
    href: "/ai",
    label: "AI Assistant",
    shortLabel: "AI Assist.",
    icon: Sparkles,
  },
  { href: "/bookings", label: "Bookings", icon: CalendarDays },
  { href: "/wallet", label: "Wallet", icon: Wallet },
  { href: "/profile", label: "Profile", icon: User },
];

export function isMainNavActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  if (href === "/ai") return pathname.startsWith("/ai");
  if (href === "/services") {
    return pathname.startsWith("/services") || pathname.startsWith("/book");
  }
  return pathname.startsWith(href);
}
