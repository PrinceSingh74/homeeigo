"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  BadgeCheck,
  Bell,
  Download,
  Lock,
  Shield,
  Trash2,
  User,
} from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { pageLead, pageTitle } from "@/lib/page-layout";
import { DevicesSessions } from "@/components/profile/DevicesSessions";
import { authApi } from "@/services/auth/auth-api";
import { coreApi } from "@/services/core/api";
import { useUpdatePreferencesMutation } from "@/hooks/use-core-data";
import { useAppStore } from "@/stores/app-store";
import { useAuthStore } from "@/stores/auth-store";
import { cn } from "@/lib/utils";

const inputClass =
  "w-full rounded-xl border border-line bg-transparent px-3 py-2.5 text-sm text-content outline-none focus:border-primary";

function SectionCard({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: typeof User;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="glass-card rounded-[28px] p-5 sm:p-6">
      <h2 className="flex items-center gap-2 font-display text-lg font-bold text-content">
        <Icon size={18} className="text-primary" />
        {title}
      </h2>
      {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description: string;
  disabled?: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-line p-3.5">
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold text-content">{label}</span>
        <span className="block text-xs text-muted">{description}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50",
          checked ? "bg-primary" : "bg-line",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 size-5 rounded-full bg-white shadow transition-all",
            checked ? "left-[22px]" : "left-0.5",
          )}
        />
      </button>
    </label>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const showToast = useAppStore((s) => s.showToast);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const fetchCurrentUser = useAuthStore((s) => s.fetchCurrentUser);

  // Fresh profile (includes notification preference flags not on the auth user).
  const { data: meData } = useQuery({
    queryKey: ["users", "me"],
    queryFn: () => coreApi.users.me(),
    staleTime: 30_000,
  });
  const me = (meData?.user ?? {}) as Record<string, unknown>;

  const updatePreferences = useUpdatePreferencesMutation();
  const [prefs, setPrefs] = useState({
    emailNotifications: true,
    pushNotifications: true,
    smsNotifications: true,
  });
  useEffect(() => {
    if (!meData?.user) return;
    setPrefs({
      emailNotifications: me.emailNotifications !== false,
      pushNotifications: me.pushNotifications !== false,
      smsNotifications: me.smsNotifications !== false,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meData?.user]);

  const togglePref = (key: keyof typeof prefs) => (next: boolean) => {
    setPrefs((p) => ({ ...p, [key]: next }));
    updatePreferences.mutate({ [key]: next });
  };

  // Account form
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [bio, setBio] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  useEffect(() => {
    if (!user) return;
    setFirstName(user.firstName ?? "");
    setLastName(user.lastName ?? "");
    setBio(user.bio ?? "");
  }, [user]);

  const saveProfile = async () => {
    if (!firstName.trim()) return showToast("First name is required", "error");
    setSavingProfile(true);
    try {
      await coreApi.users.updateMe({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        bio: bio.trim(),
      });
      await fetchCurrentUser();
      showToast("Profile updated", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not update profile", "error");
    } finally {
      setSavingProfile(false);
    }
  };

  // Password form
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [savingPw, setSavingPw] = useState(false);

  const changePassword = async () => {
    if (!currentPw || !newPw) return showToast("Enter your current and new password", "error");
    if (newPw.length < 8) return showToast("New password must be at least 8 characters", "error");
    if (newPw !== confirmPw) return showToast("New passwords do not match", "error");
    if (newPw === currentPw) return showToast("New password must differ from the current one", "error");
    setSavingPw(true);
    try {
      await authApi.changePassword(currentPw, newPw);
      showToast("Password updated successfully", "success");
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not update password", "error");
    } finally {
      setSavingPw(false);
    }
  };

  // Data export + delete
  const [exporting, setExporting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);

  const downloadExport = async (format: "json" | "zip") => {
    setExporting(true);
    try {
      if (format === "zip") {
        const req = await coreApi.compliance.requestExport();
        showToast(
          `Export request submitted (ref ${req.requestId.slice(0, 8)}). Admin review — SLA ${req.slaDaysRemaining} days.`,
          "success",
        );
        return;
      }
      const data = await coreApi.users.exportData("json");
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "homigo-export.json";
      a.click();
      URL.revokeObjectURL(url);
      showToast("JSON export downloaded (instant). ZIP exports go through compliance review.", "success");
    } catch {
      showToast("Could not export data", "error");
    } finally {
      setExporting(false);
    }
  };

  const submitDelete = async () => {
    if (deleteConfirm !== "DELETE") return showToast("Type DELETE to confirm", "error");
    setDeleting(true);
    try {
      const result = await coreApi.compliance.requestDeletion("User requested account deletion from settings");
      await logout();
      showToast(result.message ?? "Deletion request submitted for admin review", "success");
      router.replace("/login");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not delete account", "error");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <PageShell>
      <header className="mb-6 sm:mb-8">
        <Link
          href="/profile"
          className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-muted transition hover:text-primary"
        >
          <ArrowLeft size={16} />
          Back to profile
        </Link>
        <h1 className={pageTitle}>Settings</h1>
        <p className={pageLead}>Manage your account, security, notifications, and data.</p>
      </header>

      <div className="flex flex-col gap-5">
        {/* Account */}
        <SectionCard icon={User} title="Account" description="Your basic profile information.">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-muted">First name</span>
              <input value={firstName} onChange={(e) => setFirstName(e.target.value)} className={inputClass} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-muted">Last name</span>
              <input value={lastName} onChange={(e) => setLastName(e.target.value)} className={inputClass} />
            </label>
            <label className="flex flex-col gap-1.5 sm:col-span-2">
              <span className="text-xs font-semibold text-muted">Bio</span>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                rows={2}
                maxLength={280}
                className={inputClass}
              />
            </label>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void saveProfile()}
              disabled={savingProfile}
              className="rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-60"
            >
              {savingProfile ? "Saving…" : "Save changes"}
            </button>
            <div className="flex flex-col gap-1 text-xs text-muted">
              <span className="inline-flex items-center gap-1.5">
                {user?.email ?? "No email"}
                {user?.isEmailVerified ? (
                  <BadgeCheck size={14} className="text-success" />
                ) : (
                  <Link href="/verify-email" className="font-semibold text-primary hover:underline">
                    Verify
                  </Link>
                )}
              </span>
              {user?.phoneNumber ? (
                <span className="inline-flex items-center gap-1.5">
                  {user.phoneNumber}
                  {user.isPhoneVerified ? <BadgeCheck size={14} className="text-success" /> : null}
                </span>
              ) : null}
            </div>
          </div>
        </SectionCard>

        {/* Notifications */}
        <SectionCard
          icon={Bell}
          title="Notification preferences"
          description="Choose how HOMEEIGO keeps you updated. Changes save automatically."
        >
          <div className="flex flex-col gap-2.5">
            <Toggle
              checked={prefs.emailNotifications}
              onChange={togglePref("emailNotifications")}
              label="Email notifications"
              description="Booking confirmations, receipts, and offers"
              disabled={updatePreferences.isPending}
            />
            <Toggle
              checked={prefs.pushNotifications}
              onChange={togglePref("pushNotifications")}
              label="Push notifications"
              description="Real-time booking and pro-arrival updates"
              disabled={updatePreferences.isPending}
            />
            <Toggle
              checked={prefs.smsNotifications}
              onChange={togglePref("smsNotifications")}
              label="SMS notifications"
              description="OTPs and critical booking alerts"
              disabled={updatePreferences.isPending}
            />
          </div>
        </SectionCard>

        {/* Security */}
        <SectionCard icon={Lock} title="Change password" description="Use at least 8 characters.">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <input
              type="password"
              autoComplete="current-password"
              placeholder="Current password"
              value={currentPw}
              onChange={(e) => setCurrentPw(e.target.value)}
              className={inputClass}
            />
            <input
              type="password"
              autoComplete="new-password"
              placeholder="New password"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              className={inputClass}
            />
            <input
              type="password"
              autoComplete="new-password"
              placeholder="Confirm new password"
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
              className={inputClass}
            />
          </div>
          <button
            type="button"
            onClick={() => void changePassword()}
            disabled={savingPw}
            className="mt-3 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-60"
          >
            {savingPw ? "Updating…" : "Update password"}
          </button>
        </SectionCard>

        {/* Active sessions */}
        <SectionCard
          icon={Shield}
          title="Devices & sessions"
          description="Review where you're signed in and revoke anything you don't recognise."
        >
          <DevicesSessions />
        </SectionCard>

        {/* Privacy & data */}
        <SectionCard
          icon={Download}
          title="Privacy & data"
          description="Download a copy of everything HOMEEIGO stores about you."
        >
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={exporting}
              onClick={() => void downloadExport("json")}
              className="inline-flex items-center gap-1.5 rounded-xl border border-line px-4 py-2.5 text-sm font-semibold text-content transition hover:border-primary hover:text-primary disabled:opacity-60"
            >
              <Download size={15} />
              Export JSON
            </button>
            <button
              type="button"
              disabled={exporting}
              onClick={() => void downloadExport("zip")}
              className="inline-flex items-center gap-1.5 rounded-xl border border-line px-4 py-2.5 text-sm font-semibold text-content transition hover:border-primary hover:text-primary disabled:opacity-60"
            >
              <Download size={15} />
              Export ZIP
            </button>
          </div>
          <p className="mt-3 text-xs text-muted">
            <Link href="/legal/privacy" className="text-primary hover:underline">
              Privacy Policy
            </Link>
            {" · "}
            <Link href="/legal/terms" className="text-primary hover:underline">
              Terms of Service
            </Link>
            {" · "}
            <Link href="/legal/cookies" className="text-primary hover:underline">
              Cookie Policy
            </Link>
          </p>
        </SectionCard>

        {/* Danger zone */}
        <section className="rounded-[28px] border border-error/25 bg-error/5 p-5 sm:p-6">
          <h2 className="flex items-center gap-2 font-display text-lg font-bold text-error">
            <Trash2 size={18} />
            Delete account
          </h2>
          <p className="mt-1 text-sm text-muted">
            Your account is deactivated immediately and permanently deleted after 30 days. Contact
            support within 30 days to restore.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <input
              type="text"
              placeholder="Type DELETE to confirm"
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              className="w-56 rounded-xl border border-line bg-transparent px-3 py-2.5 text-sm text-content outline-none focus:border-error"
            />
            <button
              type="button"
              onClick={() => void submitDelete()}
              disabled={deleting || deleteConfirm !== "DELETE"}
              className="rounded-xl bg-error px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50"
            >
              {deleting ? "Scheduling…" : "Delete my account"}
            </button>
          </div>
        </section>
      </div>
    </PageShell>
  );
}
