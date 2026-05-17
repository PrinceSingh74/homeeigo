"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  Home,
  CalendarDays,
  Bot,
  Wallet,
  User,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS: { icon: LucideIcon; label: string }[] = [
  { icon: Home, label: "Home" },
  { icon: CalendarDays, label: "Bookings" },
  { icon: Wallet, label: "Wallet" },
  { icon: User, label: "Profile" },
];

export function BottomNav() {
  const [active, setActive] = useState("Home");
  const reduce = useReducedMotion();

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 h-20 border-t border-line glass dark:glass-dark shadow-[0_-8px_24px_rgb(0_0_0/0.10)] lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="mx-auto flex h-full max-w-md items-center justify-around px-4">
        {/* First two */}
        {ITEMS.slice(0, 2).map((it) => (
          <NavItem
            key={it.label}
            {...it}
            active={active === it.label}
            onClick={() => setActive(it.label)}
          />
        ))}

        {/* Center AI special */}
        <motion.button
          type="button"
          onClick={() => setActive("AI")}
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.95 }}
          aria-label="AI Assistant"
          className="relative -mt-8 grid size-15 place-items-center rounded-full bg-aurora text-white shadow-glow-blue outline-none focus-visible:ring-4 focus-visible:ring-primary/40"
        >
          <motion.span
            aria-hidden
            className="absolute inset-0 rounded-full border-2 border-white/40"
            animate={reduce ? undefined : { scale: [1, 1.3, 1], opacity: [0.6, 0, 0.6] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
          />
          <motion.span
            animate={reduce ? undefined : { rotate: [0, 360] }}
            transition={{ duration: 5, repeat: Infinity, ease: "linear" }}
          >
            <Bot size={24} />
          </motion.span>
        </motion.button>

        {/* Last two */}
        {ITEMS.slice(2).map((it) => (
          <NavItem
            key={it.label}
            {...it}
            active={active === it.label}
            onClick={() => setActive(it.label)}
          />
        ))}
      </div>
    </nav>
  );
}

function NavItem({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex w-14 flex-col items-center gap-1 rounded-xl py-1.5 outline-none",
        "transition-colors focus-visible:ring-2 focus-visible:ring-primary/60",
        active ? "text-primary" : "text-muted hover:text-content",
      )}
    >
      <motion.span whileTap={{ scale: 1.25 }} transition={{ duration: 0.2 }}>
        <Icon size={22} strokeWidth={active ? 2.4 : 1.9} />
      </motion.span>
      <span className={cn("text-[10px]", active && "font-bold")}>{label}</span>
    </button>
  );
}
