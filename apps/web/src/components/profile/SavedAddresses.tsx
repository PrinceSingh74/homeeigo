"use client";

import { useState } from "react";
import { m as motion, useReducedMotion } from "framer-motion";
import { ChevronRight, MoreVertical, Plus, Star } from "lucide-react";
import {
  profileInteractiveSurface,
  profilePanelPad,
  profilePanelShell,
} from "@/components/profile/profile-page-layout";
import { AddAddressModal } from "@/components/profile/AddAddressModal";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/app-store";
import {
  useAddressesQuery,
  useDeleteAddressMutation,
  useSetDefaultAddressMutation,
} from "@/hooks/use-core-data";

export function SavedAddresses() {
  const reduce = useReducedMotion();
  const openOverlay = useAppStore((s) => s.openOverlay);
  const [addOpen, setAddOpen] = useState(false);

  const { data, isLoading, isError, refetch } = useAddressesQuery();
  const setDefault = useSetDefaultAddressMutation();
  const remove = useDeleteAddressMutation();

  const addresses = data?.addresses ?? [];

  return (
    <motion.section
      initial={reduce ? false : { opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.4 }}
      className={cn(profilePanelShell, "flex h-full min-w-0 flex-col", profilePanelPad)}
    >
      <div className="mb-5 flex items-center justify-between gap-3">
        <h2 className="font-display text-base font-bold text-content">Saved Addresses</h2>
        <button
          type="button"
          onClick={() => openOverlay("location")}
          className="inline-flex items-center gap-0.5 text-[13px] font-semibold text-emerald-600 hover:underline"
        >
          Manage
          <ChevronRight size={14} />
        </button>
      </div>

      {isLoading ? (
        <ul className="flex flex-1 flex-col gap-3">
          {[0, 1].map((i) => (
            <li
              key={i}
              className="h-20 animate-pulse rounded-xl bg-surface/70 ring-1 ring-line"
            />
          ))}
        </ul>
      ) : isError ? (
        <div className="rounded-xl border border-line p-4 text-center text-sm text-muted">
          Unable to load addresses.
          <button
            type="button"
            onClick={() => void refetch()}
            className="ml-2 font-semibold text-emerald-600 underline"
          >
            Retry
          </button>
        </div>
      ) : addresses.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line p-5 text-center text-sm text-muted">
          No saved addresses yet. Add one below to book faster.
        </div>
      ) : (
        <ul className="flex flex-1 flex-col gap-3">
          {addresses.map((addr) => (
            <li key={addr.id}>
              <div
                className={cn(
                  profileInteractiveSurface,
                  "relative w-full rounded-xl p-3.5 text-left sm:p-4",
                )}
              >
                <button
                  type="button"
                  onClick={() => {
                    if (!addr.isDefault) void setDefault.mutateAsync(addr.id);
                  }}
                  className="absolute right-3 top-3 inline-flex items-center gap-1 text-xs font-semibold text-muted hover:text-emerald-600"
                  aria-label={addr.isDefault ? "Default address" : "Set as default"}
                >
                  {addr.isDefault ? (
                    <span className="inline-flex items-center gap-1 text-amber-500">
                      <Star size={14} className="fill-current" />
                      Default
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1">
                      <Star size={14} />
                      Set default
                    </span>
                  )}
                </button>
                <span className="inline-block rounded-md bg-emerald-600/10 px-2.5 py-0.5 text-[11px] font-bold text-emerald-600">
                  {addr.type ?? "Address"}
                  {addr.label ? ` (${addr.label})` : ""}
                </span>
                <p className="mt-2 line-clamp-2 pr-6 font-display text-[13px] font-bold leading-snug text-content">
                  {addr.line1}
                </p>
                <p className="mt-1 line-clamp-1 text-xs text-muted">
                  {[addr.line2, addr.city, addr.pincode].filter(Boolean).join(", ")}
                </p>
                <div className="mt-2 flex justify-end">
                  <button
                    type="button"
                    onClick={() => void remove.mutateAsync(addr.id)}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted hover:text-error"
                  >
                    <MoreVertical size={12} />
                    Remove
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={() => setAddOpen(true)}
        className={cn(
          profileInteractiveSurface,
          "mt-3 flex min-h-11 w-full items-center gap-3 rounded-xl border-dashed p-3.5 text-left sm:p-4",
        )}
      >
        <span className="grid size-9 place-items-center rounded-lg bg-[#ECFDF5] text-emerald-600 dark:bg-emerald-600/15">
          <Plus size={18} />
        </span>
        <span className="text-[13px] font-semibold text-emerald-600">Add New Address</span>
      </button>

      <AddAddressModal open={addOpen} onClose={() => setAddOpen(false)} />
    </motion.section>
  );
}
