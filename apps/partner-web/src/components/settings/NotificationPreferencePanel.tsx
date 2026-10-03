"use client";

import Link from "next/link";
import { Loader2, Lock } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { partnerApi } from "@/services/partner-api";
import type {
  NotificationCategoryName,
  NotificationChannelName,
  NotificationPreferenceCell,
} from "@/services/partner-api";
import { PartnerCard } from "@/components/ui/PartnerCard";
import { getErrorMessage } from "@/lib/api-error";
import { useToastStore } from "@/stores/toast-store";
import { cn } from "@/lib/cn";

/**
 * Notification preferences, read and written through the canonical NotificationPreference domain.
 *
 * The screen this replaced wrote four booleans on the `User` row. Two of them — email and SMS —
 * were read by nothing at all, so a partner who switched them off kept receiving both. The
 * remaining toggles described channels the platform could not necessarily use.
 *
 * Everything shown here comes from the server's resolved matrix, which is computed with the same
 * `evaluatePreference` the notification router calls. A control appears only where the recipient
 * genuinely has a choice: mandatory categories are locked, and a channel with no device, no
 * address or no configured provider is shown as unavailable rather than as an off switch.
 */

const CHANNEL_LABEL: Record<NotificationChannelName, string> = {
  IN_APP: "In-app",
  PUSH: "Push",
  EMAIL: "Email",
  SMS: "SMS",
};

const CATEGORY_COPY: Record<
  NotificationCategoryName,
  { title: string; description: string }
> = {
  TRANSACTIONAL: {
    title: "Job, payment & service updates",
    description:
      "Booking offers, job state changes, payouts and earnings. Always delivered — you need these to work.",
  },
  SECURITY: {
    title: "Account security & safety",
    description:
      "Sign-in codes, session alerts, KYC and SOS acknowledgements. Always delivered by policy.",
  },
  OPTIONAL: {
    title: "Coaching, incentives & growth",
    description:
      "Performance coaching, incentive offers, re-engagement and product news. Yours to control.",
  },
};

const UNAVAILABLE_COPY: Record<string, string> = {
  no_registered_device: "No device registered — sign in on the mobile app to enable",
  no_email_on_file: "No email address on file",
  no_phone_on_file: "No phone number on file",
  provider_not_configured: "Not available on your account yet",
};

const CATEGORY_ORDER: NotificationCategoryName[] = ["TRANSACTIONAL", "SECURITY", "OPTIONAL"];

export function NotificationPreferencePanel() {
  const qc = useQueryClient();
  const showToast = useToastStore((s) => s.showToast);

  const prefs = useQuery({
    queryKey: ["partner", "notification-preferences"],
    queryFn: () => partnerApi.notifications.preferences(),
    staleTime: 60_000,
  });

  const setPreference = useMutation({
    mutationFn: (input: {
      channel: NotificationChannelName;
      category: NotificationCategoryName;
      enabled: boolean;
    }) => partnerApi.notifications.setPreference(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["partner", "notification-preferences"] });
      showToast("Preference saved", "success");
    },
    onError: (e) => showToast(getErrorMessage(e), "error"),
  });

  if (prefs.isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-partner-muted">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Loading notification preferences…
      </div>
    );
  }

  if (prefs.isError) {
    return (
      <div className="space-y-3" role="alert">
        <h2 className="font-display text-lg font-bold">Notifications</h2>
        <p className="text-sm text-partner-muted">
          We couldn&apos;t load your preferences. Your existing settings are unchanged.
        </p>
        <button
          type="button"
          onClick={() => void prefs.refetch()}
          className="min-h-11 rounded-lg border border-partner-line px-4 text-sm font-semibold"
        >
          Try again
        </button>
      </div>
    );
  }

  const matrix = prefs.data?.matrix ?? [];
  const cellsFor = (category: NotificationCategoryName): NotificationPreferenceCell[] =>
    matrix.filter((c) => c.category === category);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-display text-lg font-bold">Notifications</h2>
        <p className="mt-1 text-sm text-partner-muted">
          Choose how Homeeigo reaches you. Job, payment and security messages are always delivered.
        </p>
      </div>

      {CATEGORY_ORDER.map((category) => {
        const cells = cellsFor(category);
        if (!cells.length) return null;
        const copy = CATEGORY_COPY[category];
        const locked = cells.every((c) => c.mandatory);

        return (
          <PartnerCard key={category} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold">{copy.title}</h3>
                <p className="mt-0.5 text-xs text-partner-muted">{copy.description}</p>
              </div>
              {locked && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-partner-surface px-2.5 py-1 text-[11px] font-semibold text-partner-muted">
                  <Lock className="h-3 w-3" aria-hidden="true" />
                  Always on
                </span>
              )}
            </div>

            <ul className="mt-3 space-y-2">
              {cells.map((cell) => {
                const inputId = `pref-${cell.category}-${cell.channel}`;
                const unavailableNote = cell.unavailableReason
                  ? UNAVAILABLE_COPY[cell.unavailableReason]
                  : undefined;

                return (
                  <li
                    key={cell.channel}
                    className={cn(
                      "flex items-center justify-between gap-3 rounded-lg border border-partner-line px-3 py-2.5",
                      !cell.available && "opacity-60",
                    )}
                  >
                    <label htmlFor={inputId} className="min-w-0 text-sm">
                      <span className="font-medium">{CHANNEL_LABEL[cell.channel]}</span>
                      {unavailableNote && (
                        <span className="mt-0.5 block text-xs text-partner-muted">
                          {unavailableNote}
                        </span>
                      )}
                    </label>
                    <input
                      id={inputId}
                      type="checkbox"
                      checked={cell.enabled}
                      disabled={!cell.editable || setPreference.isPending}
                      aria-describedby={unavailableNote ? `${inputId}-note` : undefined}
                      onChange={(e) =>
                        setPreference.mutate({
                          channel: cell.channel,
                          category: cell.category,
                          enabled: e.target.checked,
                        })
                      }
                      className="h-4 w-4 shrink-0 accent-partner-primary disabled:cursor-not-allowed"
                    />
                  </li>
                );
              })}
            </ul>
          </PartnerCard>
        );
      })}

      <Link href="/notifications" className="inline-block text-sm text-partner-primary underline">
        Open notifications center
      </Link>
    </div>
  );
}
