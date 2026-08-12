"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { coreApi } from "@/services/core/api";
import { useAuthStore } from "@/stores/auth-store";
import { useAppStore } from "@/stores/app-store";

const field =
  "w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm text-content outline-none focus:border-emerald-500";

export function EditProfileModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const user = useAuthStore((s) => s.user);
  const fetchCurrentUser = useAuthStore((s) => s.fetchCurrentUser);
  const showToast = useAppStore((s) => s.showToast);

  const [firstName, setFirstName] = useState(user?.firstName ?? "");
  const [lastName, setLastName] = useState(user?.lastName ?? "");
  const [bio, setBio] = useState(user?.bio ?? "");
  const [saving, setSaving] = useState(false);

  const valid = firstName.trim().length >= 1 && lastName.trim().length >= 1;

  const submit = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      await coreApi.users.updateMe({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        bio: bio.trim() || undefined,
      });
      await fetchCurrentUser();
      showToast("Profile updated", "success");
      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not update profile", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Edit profile" size="md">
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs font-medium text-muted">
            First name
            <input className={field} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </label>
          <label className="text-xs font-medium text-muted">
            Last name
            <input className={field} value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </label>
        </div>
        <label className="text-xs font-medium text-muted">
          Bio (optional)
          <textarea
            className={field}
            rows={3}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder="A little about you"
          />
        </label>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!valid || saving}
          className="mt-1 w-full rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-emerald-700 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>
    </Modal>
  );
}
