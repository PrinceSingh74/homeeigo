"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { useCreateAddressMutation } from "@/hooks/use-core-data";
import { AddressSearchInput } from "@/components/geo/AddressSearchInput";
import { CurrentLocationButton } from "@/components/geo/CurrentLocationButton";
import type { GeoAddress } from "@/services/core/api";

const EMPTY = {
  label: "Home",
  addressLine1: "",
  addressLine2: "",
  city: "",
  state: "",
  zipCode: "",
  // null until a real pin is provided (autocomplete / GPS) — replaces the old hardcoded coords.
  latitude: null as number | null,
  longitude: null as number | null,
};

const field =
  "w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm text-content outline-none focus:border-emerald-500";

export function AddAddressModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useCreateAddressMutation();
  const [form, setForm] = useState(EMPTY);
  const [search, setSearch] = useState("");
  const set = <K extends keyof typeof EMPTY>(k: K, v: (typeof EMPTY)[K]) => setForm((f) => ({ ...f, [k]: v }));

  // Fill the structured fields + real coordinates from a geocoded result (autocomplete or GPS).
  const applyGeo = (g: GeoAddress | null, lat: number, lng: number) => {
    setForm((f) => ({
      ...f,
      addressLine1: f.addressLine1 || (g?.formattedAddress ?? ""),
      city: g?.city ?? f.city,
      state: g?.state ?? f.state,
      zipCode: g?.postalCode ?? f.zipCode,
      latitude: lat,
      longitude: lng,
    }));
    if (g?.formattedAddress) setSearch(g.formattedAddress);
  };

  const valid =
    form.label.trim().length >= 1 &&
    form.addressLine1.trim().length >= 3 &&
    form.city.trim().length >= 2 &&
    form.state.trim().length >= 2 &&
    /^\d{6}$/.test(form.zipCode.trim());

  const submit = async () => {
    try {
      await create.mutateAsync({
        label: form.label.trim(),
        addressLine1: form.addressLine1.trim(),
        addressLine2: form.addressLine2.trim() || undefined,
        city: form.city.trim(),
        state: form.state.trim(),
        zipCode: form.zipCode.trim(),
        // Real pin from autocomplete/GPS when available; Mumbai centroid only as a last
        // resort for fully-manual entry (kept valid so the address still persists).
        latitude: form.latitude ?? 19.076,
        longitude: form.longitude ?? 72.8777,
      });
      setForm(EMPTY);
      setSearch("");
      onClose();
    } catch {
      /* the mutation surfaces the error toast */
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Add address" size="md">
      <div className="flex flex-col gap-3">
        {/* Phase 16 — search + GPS pin real coordinates (no more hardcoded location). */}
        <AddressSearchInput
          value={search}
          onChange={setSearch}
          onSelect={({ latitude, longitude, details }) => applyGeo(details, latitude, longitude)}
          placeholder="Search your address…"
        />
        <CurrentLocationButton onResolved={({ address, latitude, longitude }) => applyGeo(address, latitude, longitude)} />

        <div className="flex items-center gap-2 py-1 text-[11px] uppercase tracking-wide text-muted">
          <span className="h-px flex-1 bg-line" /> or enter manually <span className="h-px flex-1 bg-line" />
        </div>

        <label className="text-xs font-medium text-muted">
          Label
          <input className={field} value={form.label} onChange={(e) => set("label", e.target.value)} placeholder="Home, Work…" />
        </label>
        <label className="text-xs font-medium text-muted">
          Address line 1
          <input className={field} value={form.addressLine1} onChange={(e) => set("addressLine1", e.target.value)} placeholder="Flat / House no, building, street" />
        </label>
        <label className="text-xs font-medium text-muted">
          Address line 2 (optional)
          <input className={field} value={form.addressLine2} onChange={(e) => set("addressLine2", e.target.value)} placeholder="Area, locality" />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs font-medium text-muted">
            City
            <input className={field} value={form.city} onChange={(e) => set("city", e.target.value)} />
          </label>
          <label className="text-xs font-medium text-muted">
            State
            <input className={field} value={form.state} onChange={(e) => set("state", e.target.value)} />
          </label>
        </div>
        <label className="text-xs font-medium text-muted">
          PIN code
          <input
            className={field}
            value={form.zipCode}
            onChange={(e) => set("zipCode", e.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            placeholder="6-digit PIN"
          />
        </label>

        {form.latitude != null && (
          <p className="px-1 text-[11px] text-emerald-600">📍 Location pinned ({form.latitude.toFixed(4)}, {form.longitude!.toFixed(4)})</p>
        )}

        <button
          type="button"
          onClick={() => void submit()}
          disabled={!valid || create.isPending}
          className="mt-1 w-full rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-emerald-700 disabled:opacity-50"
        >
          {create.isPending ? "Saving…" : "Save address"}
        </button>
      </div>
    </Modal>
  );
}
