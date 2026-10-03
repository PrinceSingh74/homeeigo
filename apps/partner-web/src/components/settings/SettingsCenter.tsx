"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Bell,
  Clock,
  CreditCard,
  FileText,
  Loader2,
  Lock,
  MapPin,
  Moon,
  Shield,
  Sun,
  User,
} from "lucide-react";
import { PartnerCard } from "@/components/ui/PartnerCard";
import { PartnerButton } from "@/components/ui/PartnerButton";
import { OnlineToggle } from "@/components/availability/OnlineToggle";
import { NotificationPreferencePanel } from "@/components/settings/NotificationPreferencePanel";
import { usePartnerMeQuery, useUpdateProfileMutation } from "@/hooks/use-partner-data";
import { partnerApi } from "@/services/partner-api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getErrorMessage } from "@/lib/api-error";
import { useToastStore } from "@/stores/toast-store";
import { cn } from "@/lib/cn";
import { usePartnerTheme } from "@/components/theme/ThemeProvider";

const SECTIONS = [
  { id: "account", label: "Account", icon: User },
  { id: "appearance", label: "Appearance", icon: Sun },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "security", label: "Security", icon: Shield },
  { id: "availability", label: "Availability", icon: Clock },
  { id: "service", label: "Service area", icon: MapPin },
  { id: "hours", label: "Working hours", icon: Clock },
  { id: "documents", label: "Documents", icon: FileText },
  { id: "payment", label: "Payment", icon: CreditCard },
] as const;

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function SettingsCenter() {
  const [section, setSection] = useState<(typeof SECTIONS)[number]["id"]>("account");
  const me = usePartnerMeQuery();
  const { theme, setTheme } = usePartnerTheme();
  const updateProfile = useUpdateProfileMutation();
  const qc = useQueryClient();
  const showToast = useToastStore((s) => s.showToast);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [bio, setBio] = useState("");
  const [hoursStart, setHoursStart] = useState("09:00");
  const [hoursEnd, setHoursEnd] = useState("18:00");
  const [workingDays, setWorkingDays] = useState<string[]>(DAYS.slice(0, 5));
  const [paymentPref, setPaymentPref] = useState("bank_transfer");
  const [upiId, setUpiId] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);

  const provider = me.data;

  const sessionsQuery = useQuery({
    queryKey: ["partner", "security", "sessions"],
    queryFn: () => partnerApi.security.sessions(),
    enabled: section === "security",
  });

  useEffect(() => {
    if (!provider) return;
    setFirstName(provider.firstName ?? "");
    setLastName(provider.lastName ?? "");
    setBio(provider.bio ?? "");
    setHoursStart(provider.workingHoursStart ?? "09:00");
    setHoursEnd(provider.workingHoursEnd ?? "18:00");
    setWorkingDays(provider.workingDays?.length ? provider.workingDays : DAYS.slice(0, 5));
    setPaymentPref(provider.paymentMethodPreference ?? "bank_transfer");
    setUpiId(provider.upiId ?? "");
  }, [provider]);

  const saveSettings = useMutation({
    mutationFn: () =>
      partnerApi.updateSettings({
        workingHoursStart: hoursStart,
        workingHoursEnd: hoursEnd,
        workingDays,
        paymentMethodPreference: paymentPref,
        upiId: upiId.trim() || undefined,
        bio: bio.trim() || undefined,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["partner", "me"] });
      showToast("Settings saved", "success");
    },
    onError: (e) => showToast(getErrorMessage(e), "error"),
  });

  const saveProfileMutation = useMutation({
    mutationFn: async () => {
      await updateProfile.mutateAsync({
        firstName: firstName.trim() || undefined,
        lastName: lastName.trim() || undefined,
      });
      await partnerApi.updateSettings({ bio: bio.trim() || undefined });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["partner", "me"] });
      showToast("Profile saved", "success");
    },
    onError: (e) => showToast(getErrorMessage(e), "error"),
  });

  const changePassword = useMutation({
    mutationFn: () => {
      if (newPassword !== confirmPassword) {
        throw new Error("New password and confirmation do not match");
      }
      if (newPassword.length < 8) {
        throw new Error("Password must be at least 8 characters");
      }
      return partnerApi.security.changePassword({
        currentPassword,
        newPassword,
      });
    },
    onSuccess: () => {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      showToast("Password updated", "success");
    },
    onError: (e) => showToast(getErrorMessage(e), "error"),
  });

  const logoutOthers = useMutation({
    mutationFn: () => partnerApi.security.logoutOtherSessions(),
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ["partner", "security", "sessions"] });
      showToast(`Signed out ${data.revoked ?? 0} other device(s)`, "success");
    },
    onError: (e) => showToast(getErrorMessage(e), "error"),
  });

  const logoutAll = useMutation({
    mutationFn: () => partnerApi.security.logoutAllSessions(),
    onSuccess: () => {
      showToast("All sessions revoked — please sign in again", "success");
    },
    onError: (e) => showToast(getErrorMessage(e), "error"),
  });

  function toggleDay(day: string) {
    setWorkingDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day],
    );
  }

  if (me.isLoading && !provider) {
    return (
      <div className="flex items-center gap-2 text-sm text-partner-muted">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading settings…
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
      <nav className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">
        {SECTIONS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setSection(id)}
            className={cn(
              "flex shrink-0 items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition",
              section === id
                ? "bg-partner-primary text-white"
                : "bg-partner-surface text-partner-muted hover:text-partner-text",
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </nav>

      <PartnerCard className="p-5 sm:p-6">
        {section === "account" && (
          <div className="space-y-4">
            <h2 className="font-display text-lg font-bold">Profile</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="text-partner-muted">First name</span>
                <input
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="mt-1 h-10 w-full rounded-lg border border-partner-line bg-transparent px-3"
                />
              </label>
              <label className="block text-sm">
                <span className="text-partner-muted">Last name</span>
                <input
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="mt-1 h-10 w-full rounded-lg border border-partner-line bg-transparent px-3"
                />
              </label>
            </div>
            <label className="block text-sm">
              <span className="text-partner-muted">Bio</span>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                rows={3}
                className="mt-1 w-full rounded-lg border border-partner-line bg-transparent p-3"
              />
            </label>
            <PartnerButton
              onClick={() => void saveProfileMutation.mutate()}
              disabled={saveProfileMutation.isPending}
            >
              Save profile
            </PartnerButton>
            <p className="text-xs text-partner-muted">
              Full verification details on{" "}
              <Link href="/profile" className="text-partner-primary underline">
                Profile page
              </Link>
            </p>
          </div>
        )}

        {section === "appearance" && (
          <div className="space-y-4">
            <h2 className="font-display text-lg font-bold">Appearance</h2>
            <p className="text-sm text-partner-muted">
              Day mode uses the HOMEEIGO cream–sage enterprise gradient. Dark mode for night shifts.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                { id: "light" as const, label: "Day mode", icon: Sun },
                { id: "dark" as const, label: "Dark mode", icon: Moon },
              ].map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTheme(id)}
                  className={cn(
                    "flex items-center gap-3 rounded-xl border px-4 py-4 text-left transition",
                    theme === id
                      ? "border-partner-primary bg-partner-primary/10"
                      : "border-partner-line hover:border-partner-primary/40",
                  )}
                >
                  <Icon className="h-5 w-5 text-partner-primary" />
                  <span className="font-semibold">{label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {section === "notifications" && <NotificationPreferencePanel />}

        {section === "security" && (
          <div className="space-y-6">
            <div>
              <h2 className="font-display text-lg font-bold">Change password</h2>
              <div className="mt-3 grid gap-3 sm:max-w-md">
                <label className="block text-sm">
                  <span className="text-partner-muted">Current password</span>
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className="mt-1 h-10 w-full rounded-lg border border-partner-line bg-transparent px-3"
                    autoComplete="current-password"
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-partner-muted">New password</span>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="mt-1 h-10 w-full rounded-lg border border-partner-line bg-transparent px-3"
                    autoComplete="new-password"
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-partner-muted">Confirm new password</span>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="mt-1 h-10 w-full rounded-lg border border-partner-line bg-transparent px-3"
                    autoComplete="new-password"
                  />
                </label>
                <PartnerButton
                  onClick={() => void changePassword.mutate()}
                  disabled={changePassword.isPending || !currentPassword || !newPassword}
                >
                  Update password
                </PartnerButton>
              </div>
            </div>

            <div>
              <h3 className="flex items-center gap-2 font-semibold">
                <Lock className="h-4 w-4 text-partner-primary" />
                Active sessions
              </h3>
              {sessionsQuery.isLoading ? (
                <p className="mt-2 text-sm text-partner-muted">Loading sessions…</p>
              ) : (
                <ul className="mt-2 space-y-2 text-sm">
                  {(sessionsQuery.data?.sessions ?? []).map((s) => (
                    <li
                      key={s.id}
                      className="flex items-center justify-between rounded-lg border border-partner-line px-3 py-2"
                    >
                      <div>
                        <p className="font-medium">
                          {s.deviceName ?? s.platform ?? "Device"}{" "}
                          {s.isCurrent && (
                            <span className="text-xs text-partner-primary">(this device)</span>
                          )}
                        </p>
                        <p className="text-xs text-partner-muted">
                          Last active {new Date(s.lastActiveAt).toLocaleString("en-IN")}
                        </p>
                      </div>
                      {!s.isCurrent && (
                        <button
                          type="button"
                          className="text-xs font-semibold text-red-600"
                          onClick={() =>
                            void partnerApi.security
                              .revokeSession(s.id)
                              .then(() => sessionsQuery.refetch())
                              .then(() => showToast("Session revoked", "success"))
                              .catch((e) => showToast(getErrorMessage(e), "error"))
                          }
                        >
                          Sign out
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <PartnerButton
                  variant="outline"
                  onClick={() => void logoutOthers.mutate()}
                  disabled={logoutOthers.isPending}
                >
                  Sign out other devices
                </PartnerButton>
                <PartnerButton
                  variant="outline"
                  onClick={() => void logoutAll.mutate()}
                  disabled={logoutAll.isPending}
                >
                  Sign out all devices
                </PartnerButton>
              </div>
            </div>

            <div className="rounded-lg border border-partner-line p-4">
              <h3 className="font-semibold">Two-factor authentication (2FA)</h3>
              <p className="mt-1 text-sm text-partner-muted">
                Backend-ready architecture — enable stronger sign-in when your ops team activates
                TOTP for partner accounts.
              </p>
              <label className="mt-3 flex items-center justify-between text-sm">
                <span>Enable 2FA</span>
                <input
                  type="checkbox"
                  checked={twoFactorEnabled}
                  onChange={(e) => setTwoFactorEnabled(e.target.checked)}
                  disabled
                  className="h-4 w-4 accent-partner-primary opacity-50"
                />
              </label>
              <p className="mt-2 text-xs text-partner-muted">
                Recovery codes will be generated here when 2FA is enabled by your administrator.
              </p>
            </div>
          </div>
        )}

        {section === "availability" && (
          <div className="space-y-4">
            <h2 className="font-display text-lg font-bold">Availability</h2>
            <OnlineToggle />
          </div>
        )}

        {section === "service" && (
          <div className="space-y-4">
            <h2 className="font-display text-lg font-bold">Service area</h2>
            <p className="text-sm text-partner-muted">
              Manage coverage on the Availability workspace — map, radius, and preferred zones.
            </p>
            <Link href="/availability" className="inline-flex min-h-11 items-center text-sm font-semibold text-partner-primary">
              Open service areas
            </Link>
          </div>
        )}

        {section === "hours" && (
          <div className="space-y-4">
            <h2 className="font-display text-lg font-bold">Working hours</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm">
                <span className="text-partner-muted">Start</span>
                <input
                  type="time"
                  value={hoursStart}
                  onChange={(e) => setHoursStart(e.target.value)}
                  className="mt-1 h-10 w-full rounded-lg border border-partner-line bg-transparent px-3"
                />
              </label>
              <label className="text-sm">
                <span className="text-partner-muted">End</span>
                <input
                  type="time"
                  value={hoursEnd}
                  onChange={(e) => setHoursEnd(e.target.value)}
                  className="mt-1 h-10 w-full rounded-lg border border-partner-line bg-transparent px-3"
                />
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              {DAYS.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => toggleDay(d)}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-xs font-bold",
                    workingDays.includes(d)
                      ? "bg-partner-primary text-white"
                      : "bg-partner-surface text-partner-muted",
                  )}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
        )}

        {section === "documents" && (
          <div className="space-y-3">
            <h2 className="font-display text-lg font-bold">Documents & certifications</h2>
            <ul className="space-y-2 text-sm">
              {(provider?.certifications ?? []).length ? (
                provider!.certifications!.map((c) => (
                  <li key={c} className="flex items-center gap-2 rounded-lg bg-partner-surface px-3 py-2">
                    <FileText className="h-4 w-4 text-partner-primary" />
                    {c}
                  </li>
                ))
              ) : (
                <li className="text-partner-muted">No certifications on file</li>
              )}
            </ul>
            <p className="text-xs text-partner-muted">KYC: {provider?.kycStatus ?? "—"}</p>
          </div>
        )}

        {section === "payment" && (
          <div className="space-y-4">
            <h2 className="font-display text-lg font-bold">Payment preferences</h2>
            <label className="block text-sm">
              <span className="text-partner-muted">Preferred method</span>
              <select
                value={paymentPref}
                onChange={(e) => setPaymentPref(e.target.value)}
                className="mt-1 h-10 w-full rounded-lg border border-partner-line bg-partner-surface px-3"
              >
                <option value="bank_transfer">Bank transfer</option>
                <option value="upi">UPI</option>
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-partner-muted">UPI ID</span>
              <input
                value={upiId}
                onChange={(e) => setUpiId(e.target.value)}
                placeholder="name@upi"
                className="mt-1 h-10 w-full rounded-lg border border-partner-line bg-transparent px-3"
              />
            </label>
          </div>
        )}

        {["hours", "payment", "service"].includes(section) && (
          <PartnerButton
            className="mt-6"
            onClick={() => saveSettings.mutate()}
            disabled={saveSettings.isPending}
          >
            {saveSettings.isPending ? "Saving…" : "Save settings"}
          </PartnerButton>
        )}
      </PartnerCard>
    </div>
  );
}
