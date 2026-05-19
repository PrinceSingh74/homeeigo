"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { MapPin, ChevronDown, Bell, Sparkles } from "lucide-react";
import { IconButton } from "@/components/buttons/IconButton";
import { ThemeToggle } from "@/components/ThemeToggle";

export function Navbar() {
  return (
    <motion.header
      initial={{ y: -64, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="sticky top-0 z-50 h-16 w-full border-b border-line glass dark:glass-dark shadow-e2"
    >
      <nav className="mx-auto flex h-full max-w-content items-center justify-between gap-4 px-4 sm:px-6">
        {/* Left — Logo */}
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2 outline-none focus-visible:ring-2 focus-visible:ring-primary/60 rounded-lg"
          aria-label="HOMIGO home"
        >
          <span className="grid size-7 place-items-center rounded-lg bg-aurora text-white shadow-glow-blue">
            <Sparkles size={16} />
          </span>
          <span className="font-display text-xl font-bold tracking-tight text-aurora">
            HOMIGO
          </span>
        </Link>

        {/* Primary nav */}
        <nav className="hidden items-center gap-1 md:flex">
          <Link
            href="/"
            className="rounded-full px-4 py-2 text-sm font-semibold text-content transition-colors hover:bg-primary/5 hover:text-primary outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          >
            Home
          </Link>
          <Link
            href="/book"
            className="rounded-full bg-aurora px-4 py-2 text-sm font-semibold text-white shadow-glow-blue transition-transform hover:-translate-y-0.5 outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          >
            Book a Service
          </Link>
        </nav>

        {/* Center — Location selector */}
        <motion.button
          type="button"
          whileHover={{ y: -1 }}
          whileTap={{ scale: 0.98 }}
          className="group flex h-9 items-center gap-2 rounded-full border border-line bg-surface px-3 text-sm shadow-e1 transition-colors hover:bg-primary/5 outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          aria-label="Change location"
        >
          <MapPin size={16} className="text-primary" />
          <span className="hidden font-medium text-content sm:inline">
            Gurugram, Sector&nbsp;49
          </span>
          <span className="font-medium text-content sm:hidden">Gurugram</span>
          <ChevronDown
            size={16}
            className="text-muted transition-transform group-hover:translate-y-0.5"
          />
        </motion.button>

        {/* Right — Actions */}
        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <ThemeToggle />

          <IconButton label="Notifications" className="relative">
            <Bell size={20} />
            <span className="absolute right-1.5 top-1.5 grid size-4 place-items-center rounded-full bg-pink text-[10px] font-bold text-white ring-2 ring-surface">
              1
            </span>
          </IconButton>

          <motion.button
            type="button"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.97 }}
            aria-label="Open profile"
            className="ml-1 grid size-10 place-items-center rounded-full bg-premium text-sm font-bold text-white ring-2 ring-primary shadow-[0_0_12px_rgb(37_99_235/0.25)] outline-none focus-visible:ring-4 focus-visible:ring-primary/50"
          >
            A
          </motion.button>
        </div>
      </nav>
    </motion.header>
  );
}
