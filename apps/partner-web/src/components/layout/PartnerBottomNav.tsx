"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, MapPin, Wallet, User, Zap } from "lucide-react";
import { cn } from "@/lib/cn";

const tabs = [
  { href: "/", label: "Home", icon: Home },
  { href: "/requests", label: "Requests", icon: Zap },
  { href: "/map", label: "Map", icon: MapPin },
  { href: "/wallet", label: "Wallet", icon: Wallet },
  { href: "/profile", label: "Profile", icon: User },
] as const;

export function PartnerBottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="partner-glass fixed bottom-0 left-0 right-0 z-50 mx-auto max-w-lg border-t border-partner-line px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 md:max-w-2xl lg:hidden"
      aria-label="Partner navigation"
    >
      <ul className="flex items-center justify-around">
        {tabs.map(({ href, label, icon: Icon }) => {
          const active =
            href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <li key={href}>
              <Link
                href={href}
                className={cn(
                  "flex flex-col items-center gap-0.5 rounded-xl px-3 py-2 text-[10px] font-medium transition",
                  active
                    ? "text-partner-primary"
                    : "text-partner-muted hover:text-partner-text"
                )}
              >
                <Icon
                  className={cn("h-5 w-5", active && "drop-shadow-[0_0_8px_rgb(37_99_235/0.8)]")}
                  strokeWidth={active ? 2.5 : 2}
                />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
