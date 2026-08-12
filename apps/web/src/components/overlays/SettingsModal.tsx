"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, ChevronRight, Download, Lock, MapPin, Moon, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useAppStore } from "@/stores/app-store";
import { LOCATIONS } from "@/lib/services";
import { authApi } from "@/services/auth/auth-api";
import { coreApi } from "@/services/core/api";
import { useAuthStore } from "@/stores/auth-store";

export function SettingsModal({ open }: { open: boolean }) {
  const router = useRouter();
  const closeOverlay = useAppStore((s) => s.closeOverlay);
  const openOverlay = useAppStore((s) => s.openOverlay);
  const locationId = useAppStore((s) => s.locationId);
  const showToast = useAppStore((s) => s.showToast);
  const logout = useAuthStore((s) => s.logout);
  const loc = LOCATIONS.find((l) => l.id === locationId);

  const [showPw, setShowPw] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  const submitPassword = async () => {
    if (!current || !next) return showToast("Enter your current and new password", "error");
    if (next.length < 8) return showToast("New password must be at least 8 characters", "error");
    if (next !== confirm) return showToast("New passwords do not match", "error");
    if (next === current) return showToast("New password must differ from the current one", "error");
    setSaving(true);
    try {
      await authApi.changePassword(current, next);
      showToast("Password updated successfully", "success");
      setCurrent("");
      setNext("");
      setConfirm("");
      setShowPw(false);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not update password", "error");
    } finally {
      setSaving(false);
    }
  };

  const downloadExport = async (format: "json" | "zip") => {
    setExporting(true);
    try {
      if (format === "zip") {
        const req = await coreApi.compliance.requestExport();
        showToast(
          `Export request submitted. Admin review — SLA ${req.slaDaysRemaining} days.`,
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
      showToast("JSON export downloaded", "success");
    } catch {
      showToast("Could not export data", "error");
    } finally {
      setExporting(false);
    }
  };

  const submitDelete = async () => {
    if (deleteConfirm !== "DELETE") {
      showToast('Type DELETE to confirm', "error");
      return;
    }
    setDeleting(true);
    try {
      const result = await coreApi.compliance.requestDeletion("User requested account deletion from settings");
      await logout();
      closeOverlay();
      showToast(result.message ?? "Deletion request submitted for admin review", "success");
      router.replace("/login");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not delete account", "error");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Modal open={open} onClose={closeOverlay} title="Settings" size="md">
      <ul className="flex flex-col gap-2">
        <li>
          <Link
            href="/settings"
            onClick={closeOverlay}
            className="flex w-full items-center gap-3 rounded-2xl border border-primary/25 bg-primary/5 px-4 py-3.5 text-left transition hover:bg-primary/10"
          >
            <span className="flex-1">
              <span className="block text-sm font-bold text-primary">Open full settings</span>
              <span className="block text-xs text-muted">
                Notifications, security, sessions & data
              </span>
            </span>
            <ChevronRight size={18} className="text-primary" />
          </Link>
        </li>
        <li>
          <button
            type="button"
            onClick={() => openOverlay("location")}
            className="flex w-full items-center gap-3 rounded-2xl glass-card px-4 py-3.5 text-left transition hover:bg-primary/5"
          >
            <MapPin size={20} className="text-primary" />
            <span className="flex-1">
              <span className="block text-sm font-bold text-content">Service location</span>
              <span className="block text-xs text-muted">{loc?.label ?? "Set area"}</span>
            </span>
            <ChevronRight size={18} className="text-muted" />
          </button>
        </li>
        <li>
          <button
            type="button"
            onClick={() => showToast("Push notifications enabled for bookings & offers", "success")}
            className="flex w-full items-center gap-3 rounded-2xl glass-card px-4 py-3.5 text-left transition hover:bg-primary/5"
          >
            <Bell size={20} className="text-primary" />
            <span className="flex-1">
              <span className="block text-sm font-bold text-content">Notifications</span>
              <span className="block text-xs text-muted">Bookings, offers, pro updates</span>
            </span>
            <ChevronRight size={18} className="text-muted" />
          </button>
        </li>
        <li>
          <button
            type="button"
            onClick={() =>
              showToast("Use the sun/moon toggle in the header for theme", "info")
            }
            className="flex w-full items-center gap-3 rounded-2xl glass-card px-4 py-3.5 text-left transition hover:bg-primary/5"
          >
            <Moon size={20} className="text-primary" />
            <span className="flex-1">
              <span className="block text-sm font-bold text-content">Appearance</span>
              <span className="block text-xs text-muted">Light / dark mode</span>
            </span>
            <ChevronRight size={18} className="text-muted" />
          </button>
        </li>
        <li>
          <button
            type="button"
            onClick={() => setShowPw((v) => !v)}
            className="flex w-full items-center gap-3 rounded-2xl glass-card px-4 py-3.5 text-left transition hover:bg-primary/5"
          >
            <Lock size={20} className="text-primary" />
            <span className="flex-1">
              <span className="block text-sm font-bold text-content">Change password</span>
              <span className="block text-xs text-muted">Update your account password</span>
            </span>
            <ChevronRight
              size={18}
              className={`text-muted transition-transform ${showPw ? "rotate-90" : ""}`}
            />
          </button>
          {showPw && (
            <div className="mt-2 flex flex-col gap-2 rounded-2xl glass-card p-4">
              <input
                type="password"
                autoComplete="current-password"
                placeholder="Current password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                className="w-full rounded-xl border border-line bg-transparent px-3 py-2.5 text-sm text-content outline-none focus:border-primary"
              />
              <input
                type="password"
                autoComplete="new-password"
                placeholder="New password (min 8 chars)"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                className="w-full rounded-xl border border-line bg-transparent px-3 py-2.5 text-sm text-content outline-none focus:border-primary"
              />
              <input
                type="password"
                autoComplete="new-password"
                placeholder="Confirm new password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="w-full rounded-xl border border-line bg-transparent px-3 py-2.5 text-sm text-content outline-none focus:border-primary"
              />
              <button
                type="button"
                onClick={() => void submitPassword()}
                disabled={saving}
                className="mt-1 w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-60"
              >
                {saving ? "Updating…" : "Update password"}
              </button>
            </div>
          )}
        </li>
        <li>
          <div className="flex w-full flex-col gap-2 rounded-2xl glass-card px-4 py-3.5">
            <span className="text-sm font-bold text-content">Privacy & data</span>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={exporting}
                onClick={() => void downloadExport("json")}
                className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-xs font-semibold text-content"
              >
                <Download size={14} />
                Export JSON
              </button>
              <button
                type="button"
                disabled={exporting}
                onClick={() => void downloadExport("zip")}
                className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-xs font-semibold text-content"
              >
                <Download size={14} />
                Export ZIP
              </button>
            </div>
            <p className="text-xs text-muted">
              <Link href="/legal/privacy" className="text-primary hover:underline">
                Privacy Policy
              </Link>
              {" · "}
              <Link href="/legal/terms" className="text-primary hover:underline">
                Terms
              </Link>
            </p>
          </div>
        </li>
        <li>
          <button
            type="button"
            onClick={() => setShowDelete((v) => !v)}
            className="flex w-full items-center gap-3 rounded-2xl border border-[#FECACA] bg-[#FEE2E2] px-4 py-3.5 text-left transition hover:bg-[#FCA5A5]/30 dark:border-error/30 dark:bg-error/10"
          >
            <Trash2 size={20} className="text-error" />
            <span className="flex-1">
              <span className="block text-sm font-bold text-error">Delete account</span>
              <span className="block text-xs text-muted">30-day restore window via support</span>
            </span>
            <ChevronRight
              size={18}
              className={`text-error/60 transition-transform ${showDelete ? "rotate-90" : ""}`}
            />
          </button>
          {showDelete && (
            <div className="mt-2 flex flex-col gap-2 rounded-2xl border border-error/20 bg-error/5 p-4">
              <p className="text-xs text-muted">
                Your account will be deactivated immediately. Data is permanently removed after 30
                days unless you contact support to restore.
              </p>
              <input
                type="text"
                placeholder='Type DELETE to confirm'
                value={deleteConfirm}
                onChange={(e) => setDeleteConfirm(e.target.value)}
                className="w-full rounded-xl border border-line bg-transparent px-3 py-2.5 text-sm text-content outline-none focus:border-error"
              />
              <button
                type="button"
                onClick={() => void submitDelete()}
                disabled={deleting}
                className="w-full rounded-xl bg-error px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60"
              >
                {deleting ? "Scheduling…" : "Delete my account"}
              </button>
            </div>
          )}
        </li>
      </ul>
    </Modal>
  );
}
