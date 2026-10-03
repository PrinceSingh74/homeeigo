import { create } from "zustand";

export type FeatureFlags = {
  AI_CONCIERGE: boolean;
};

interface FeatureFlagsState {
  flags: FeatureFlags;
  setFlag: (flag: keyof FeatureFlags, value: boolean) => void;
  setFlags: (flags: Partial<FeatureFlags>) => void;
  isEnabled: (flag: keyof FeatureFlags) => boolean;
}

export const useFeatureFlagsStore = create<FeatureFlagsState>((set, get) => ({
  flags: {
    AI_CONCIERGE: process.env.EXPO_PUBLIC_FEATURE_AI_CONCIERGE === "true",
  },

  setFlag: (flag, value) =>
    set((state) => ({
      flags: { ...state.flags, [flag]: value },
    })),

  setFlags: (updates) =>
    set((state) => ({
      flags: { ...state.flags, ...updates },
    })),

  isEnabled: (flag) => get().flags[flag] ?? false,
}));
