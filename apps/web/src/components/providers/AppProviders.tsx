"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { AuthProvider } from "@/providers/AuthProvider";
import { QueryProvider } from "@/providers/QueryProvider";
import { MotionProvider } from "./MotionProvider";
import { useAppStore } from "@/stores/app-store";
import { cn } from "@/lib/utils";
import { getPendingPaymentBookingId } from "@/hooks/use-booking-payment";
import { CookieConsentBanner } from "@/components/legal/CookieConsentBanner";

const RealtimeBridge = dynamic(
  () => import("@/components/realtime/RealtimeBridge").then((m) => ({ default: m.RealtimeBridge })),
  { ssr: false },
);
const ActiveBookingChannel = dynamic(
  () =>
    import("@/components/realtime/ActiveBookingChannel").then((m) => ({
      default: m.ActiveBookingChannel,
    })),
  { ssr: false },
);

function DeferredRealtime() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const run = () => setReady(true);
    if (typeof requestIdleCallback === "function") {
      const id = requestIdleCallback(run, { timeout: 3000 });
      return () => cancelIdleCallback(id);
    }
    const t = window.setTimeout(run, 1500);
    return () => window.clearTimeout(t);
  }, []);
  if (!ready) return null;
  return (
    <>
      <RealtimeBridge />
      <ActiveBookingChannel />
    </>
  );
}

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
  const showToast = useAppStore((s) => s.showToast);
  useEffect(() => {
    const pending = getPendingPaymentBookingId();
    if (pending) {
      showToast("Pending payment found. Open booking details to retry payment.", "info");
    }
  }, [showToast]);
  return (
    <QueryProvider>
      <AuthProvider>
        <MotionProvider>
        {children}
        {/* Mount ONLY the active overlay. Rendering all of them with
            open={false} forced every dynamic() chunk to download+compile on
            every page load (12 chunks) — measured as a top dev-nav cost. */}
        {overlay === "location" && <LocationPicker open />}
        {overlay === "notifications" && <NotificationsPanel open />}
        {overlay === "profile" && <ProfileMenu open />}
        {overlay === "ai" && <AiAssistantSheet open />}
        {overlay === "how-it-works" && <HowItWorksModal open />}
        {overlay === "quick-filters" && <QuickFiltersPanel open />}
        {overlay === "premium" && <PremiumModal open />}
        {overlay === "wallet" && <WalletModal open />}
        {overlay === "support" && <SupportModal open />}
        {overlay === "settings" && <SettingsModal open />}
        <ServicesOverlays />
        <DeferredRealtime />
        <CookieConsentBanner />

        <div
          aria-live="polite"
          className="pointer-events-none fixed bottom-24 left-1/2 z-[110] flex w-full max-w-sm -translate-x-1/2 flex-col gap-2 px-4 lg:bottom-8"
        >
          {toasts.map((t) => (
            <div
              key={t.id}
              className={cn(
                "pointer-events-auto animate-[fadeInUp_0.25s_ease-out] rounded-2xl px-5 py-3 text-sm font-semibold shadow-e5",
                t.type === "success" && "bg-success text-white",
                t.type === "error" && "bg-error text-white",
                (!t.type || t.type === "info") && "bg-ink text-white",
              )}
            >
              {t.message}
            </div>
          ))}
        </div>
        </MotionProvider>
      </AuthProvider>
    </QueryProvider>
  );
}
