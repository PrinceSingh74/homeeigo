"use client";

import { useEffect, useState } from "react";
import { m as motion, AnimatePresence } from "framer-motion";
import { Sun, Moon } from "lucide-react";
import { IconButton } from "@/components/buttons/IconButton";
import { cn } from "@/lib/utils";

type ThemeToggleProps = {
  size?: number;
  className?: string;
};

export function ThemeToggle({ size = 40, className }: ThemeToggleProps) {
  const [dark, setDark] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("homigo-theme", next ? "dark" : "light");
    } catch {
      /* storage unavailable — ignore */
    }
  }

  if (!mounted) {
    return (
      <span
        aria-hidden
        className={cn("inline-block shrink-0", className)}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <IconButton
      label={dark ? "Switch to light mode" : "Switch to dark mode"}
      size={size}
      onClick={toggle}
      className={cn("shrink-0 text-content/70 hover:text-primary", className)}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={dark ? "moon" : "sun"}
          initial={{ rotate: -90, opacity: 0 }}
          animate={{ rotate: 0, opacity: 1 }}
          exit={{ rotate: 90, opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="grid place-items-center"
        >
          {dark ? (
            <Moon size={size >= 40 ? 20 : 18} />
          ) : (
            <Sun size={size >= 40 ? 20 : 18} />
          )}
        </motion.span>
      </AnimatePresence>
    </IconButton>
  );
}
