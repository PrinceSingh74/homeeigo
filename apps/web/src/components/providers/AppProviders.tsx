"use client";

import dynamic from "next/dynamic";
import { AnimatePresence, motion } from "framer-motion";
import { useAppStore } from "@/stores/app-store";
import { cn } from "@/lib/utils";

const LocationPicker = dynamic(
  () =>
    import("@/components/overlays/LocationPicker").then((m) => ({
      default: m.LocationPicker,
    })),
  { ssr: false },
);
const NotificationsPanel = dynamic(
  () =>
    import("@/components/overlays/NotificationsPanel").then((m) => ({
      default: m.NotificationsPanel,
    })),
  { ssr: false },
);
const ProfileMenu = dynamic(
  () =>
    import("@/components/overlays/ProfileMenu").then((m) => ({
      default: m.ProfileMenu,
    })),
  { ssr: false },
);
const AiAssistantSheet = dynamic(
  () =>
    import("@/components/overlays/AiAssistantSheet").then((m) => ({
      default: m.AiAssistantSheet,
    })),
  { ssr: false },
);
const HowItWorksModal = dynamic(
  () =>
    import("@/components/overlays/HowItWorksModal").then((m) => ({
      default: m.HowItWorksModal,
    })),
  { ssr: false },
);
const QuickFiltersPanel = dynamic(
  () =>
    import("@/components/overlays/QuickFiltersPanel").then((m) => ({
      default: m.QuickFiltersPanel,
    })),
  { ssr: false },
);
const PremiumModal = dynamic(
  () =>
    import("@/components/overlays/PremiumModal").then((m) => ({
      default: m.PremiumModal,
    })),
  { ssr: false },
);
const WalletModal = dynamic(
  () =>
    import("@/components/overlays/WalletModal").then((m) => ({
      default: m.WalletModal,
    })),
  { ssr: false },
);
const SupportModal = dynamic(
  () =>
    import("@/components/overlays/SupportModal").then((m) => ({
      default: m.SupportModal,
    })),
  { ssr: false },
);
const SettingsModal = dynamic(
  () =>
    import("@/components/overlays/SettingsModal").then((m) => ({
      default: m.SettingsModal,
    })),
  { ssr: false },
);
const ServicesOverlays = dynamic(
  () =>
    import("@/components/overlays/ServicesOverlays").then((m) => ({
      default: m.ServicesOverlays,
    })),
  { ssr: false },
);

export function AppProviders({ children }: { children: React.ReactNode }) {
  const overlay = useAppStore((s) => s.overlay);
  const toasts = useAppStore((s) => s.toasts);
  return (
    <>
      {children}
      <LocationPicker open={overlay === "location"} />
      <NotificationsPanel open={overlay === "notifications"} />
      <ProfileMenu open={overlay === "profile"} />
      <AiAssistantSheet open={overlay === "ai"} />
      <HowItWorksModal open={overlay === "how-it-works"} />
      <QuickFiltersPanel open={overlay === "quick-filters"} />
      <PremiumModal open={overlay === "premium"} />
      <WalletModal open={overlay === "wallet"} />
      <SupportModal open={overlay === "support"} />
      <SettingsModal open={overlay === "settings"} />
      <ServicesOverlays />

      <motion.div
        aria-live="polite"
        className="pointer-events-none fixed bottom-24 left-1/2 z-[110] flex w-full max-w-sm -translate-x-1/2 flex-col gap-2 px-4 lg:bottom-8"
      >
        <AnimatePresence mode="popLayout">
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.96 }}
              className={cn(
                "pointer-events-auto rounded-2xl px-5 py-3 text-sm font-semibold shadow-e5",
                t.type === "success" && "bg-success text-white",
                t.type === "error" && "bg-error text-white",
                (!t.type || t.type === "info") && "bg-ink text-white",
              )}
            >
              {t.message}
            </motion.div>
          ))}
        </AnimatePresence>
      </motion.div>
    </>
  );
}
