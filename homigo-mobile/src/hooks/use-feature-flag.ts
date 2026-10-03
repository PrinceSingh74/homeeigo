import { useFeatureFlagsStore } from "@/stores/feature-flags-store";
import type { FeatureFlags } from "@/stores/feature-flags-store";

export function useFeatureFlag(flag: keyof FeatureFlags): boolean {
  return useFeatureFlagsStore((state) => state.isEnabled(flag));
}
