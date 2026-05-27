"use client";

import { MapPin, Check } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { LOCATIONS } from "@/lib/services";
import { useAppStore } from "@/stores/app-store";
import { cn } from "@/lib/utils";

export function LocationPicker({ open }: { open: boolean }) {
  const locationId = useAppStore((s) => s.locationId);
  const setLocationId = useAppStore((s) => s.setLocationId);
  const closeOverlay = useAppStore((s) => s.closeOverlay);

  return (
    <Modal
      open={open}
      onClose={closeOverlay}
      title="Choose your location"
      size="sm"
    >
      <p className="mb-4 text-sm text-muted">
        Services and pricing may vary by area. We&apos;ll match you with nearby
        verified professionals.
      </p>
      <ul className="flex flex-col gap-2">
        {LOCATIONS.map((loc) => {
          const active = loc.id === locationId;
          return (
            <li key={loc.id}>
              <button
                type="button"
                onClick={() => {
                  setLocationId(loc.id);
                  closeOverlay();
                }}
                className={cn(
                  "flex w-full items-center gap-3 rounded-2xl px-4 py-4 text-left transition",
                  active
                    ? "bg-primary/10 ring-2 ring-primary"
                    : "glass-card hover:bg-primary/5",
                )}
              >
                <MapPin
                  size={20}
                  className={active ? "text-primary" : "text-muted"}
                />
                <span className="flex-1">
                  <span className="block text-sm font-bold text-content">
                    {loc.label}
                  </span>
                  <span className="block text-xs text-muted">
                    {loc.city} · PIN {loc.pin}
                  </span>
                </span>
                {active && (
                  <span className="grid size-8 place-items-center rounded-full bg-primary text-white">
                    <Check size={16} strokeWidth={3} />
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
