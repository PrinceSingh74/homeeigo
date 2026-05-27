"use client";

import { Bell, ChevronRight, MapPin, Moon } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useAppStore } from "@/stores/app-store";
import { LOCATIONS } from "@/lib/services";

export function SettingsModal({ open }: { open: boolean }) {
  const closeOverlay = useAppStore((s) => s.closeOverlay);
  const openOverlay = useAppStore((s) => s.openOverlay);
  const locationId = useAppStore((s) => s.locationId);
  const showToast = useAppStore((s) => s.showToast);
  const loc = LOCATIONS.find((l) => l.id === locationId);

  return (
    <Modal open={open} onClose={closeOverlay} title="Settings" size="md">
      <ul className="flex flex-col gap-2">
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
      </ul>
    </Modal>
  );
}
