import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useColorScheme } from "react-native";

export type ThemePreference = "system" | "light" | "dark";

type ThemeState = {
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
  /** Flip between light ↔ dark (saved choice, not system) */
  toggleDarkLight: () => void;
};

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      preference: "system",
      setPreference: (preference) => set({ preference }),
      toggleDarkLight: () => {
        const { preference } = get();
        if (preference === "dark") set({ preference: "light" });
        else set({ preference: "dark" });
      },
    }),
    {
      name: "homigo-theme-preference",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ preference: s.preference }),
    },
  ),
);

/** Resolved dark mode for UI (store overrides system when light/dark set) */
export function useResolvedIsDark(): boolean {
  const system = useColorScheme();
  const preference = useThemeStore((s) => s.preference);
  if (preference === "dark") return true;
  if (preference === "light") return false;
  return system !== "light";
}

export function useThemeToggle() {
  const isDark = useResolvedIsDark();
  const setPreference = useThemeStore((s) => s.setPreference);
  const toggle = () => setPreference(isDark ? "light" : "dark");
  return { isDark, toggle, setPreference };
}
