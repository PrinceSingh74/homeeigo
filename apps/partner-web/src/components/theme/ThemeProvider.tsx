"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type PartnerTheme = "light" | "dark";

type ThemeContextValue = {
  theme: PartnerTheme;
  setTheme: (theme: PartnerTheme) => void;
  toggleTheme: () => void;
};

const STORAGE_KEY = "homeeigo-partner-theme";

const ThemeContext = createContext<ThemeContextValue | null>(null);

function applyTheme(theme: PartnerTheme) {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<PartnerTheme>("light");

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as PartnerTheme | null;
    const initial: PartnerTheme =
      stored === "dark" || stored === "light"
        ? stored
        : window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";
    setThemeState(initial);
    applyTheme(initial);
  }, []);

  const setTheme = useCallback((next: PartnerTheme) => {
    setThemeState(next);
    localStorage.setItem(STORAGE_KEY, next);
    applyTheme(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [setTheme, theme]);

  const value = useMemo(
    () => ({ theme, setTheme, toggleTheme }),
    [theme, setTheme, toggleTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function usePartnerTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("usePartnerTheme must be used within ThemeProvider");
  return ctx;
}
