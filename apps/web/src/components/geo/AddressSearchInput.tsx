"use client";

import { useEffect, useId, useRef, useState } from "react";
import { MapPin, Loader2, Search } from "lucide-react";
import { useGeoAutocomplete } from "@/hooks/use-geo-autocomplete";
import { coreApi, type GeoAddress } from "@/services/core/api";

/**
 * Phase 16.2 — accessible, debounced address autocomplete. On select, resolves full
 * coordinates via /api/geo/place and returns a {address, latitude, longitude}. Falls back
 * to plain manual entry when the backend reports Google is not configured.
 */
export function AddressSearchInput({
  value,
  onChange,
  onSelect,
  placeholder = "Search for area, street, society…",
  bias,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  onSelect: (picked: { address: string; latitude: number; longitude: number; details: GeoAddress }) => void;
  placeholder?: string;
  bias?: { lat?: number; lng?: number };
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [resolving, setResolving] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const { predictions, available, isLoading, isActive } = useGeoAutocomplete(value, { lat: bias?.lat, lng: bias?.lng });

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    if (isActive && predictions.length > 0) setOpen(true);
  }, [isActive, predictions.length]);

  const pick = async (placeId: string, description: string) => {
    setOpen(false);
    setResolving(true);
    onChange(description);
    try {
      const details = await coreApi.geo.place(placeId);
      if (details) onSelect({ address: details.formattedAddress, latitude: details.latitude, longitude: details.longitude, details });
    } finally {
      setResolving(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open || predictions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, predictions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      const p = predictions[active]!;
      void pick(p.placeId, p.description);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div ref={boxRef} className={`relative w-full ${className ?? ""}`}>
      <div className="flex items-center gap-2 rounded-xl border bg-white px-3 py-2.5 focus-within:ring-2 focus-within:ring-primary/50">
        <Search size={18} className="shrink-0 text-gray-400" aria-hidden />
        <input
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setActive(-1);
          }}
          onFocus={() => predictions.length > 0 && setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className="w-full bg-transparent text-sm outline-none placeholder:text-gray-400"
        />
        {(isLoading || resolving) && <Loader2 size={16} className="shrink-0 animate-spin text-gray-400" aria-hidden />}
      </div>

      {open && predictions.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-xl border bg-white py-1 shadow-lg"
        >
          {predictions.map((p, i) => (
            <li key={p.placeId} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => void pick(p.placeId, p.description)}
                className={`flex w-full items-start gap-2.5 px-3 py-2 text-left text-sm ${i === active ? "bg-primary/5" : ""}`}
              >
                <MapPin size={16} className="mt-0.5 shrink-0 text-primary" aria-hidden />
                <span className="min-w-0">
                  <span className="block truncate font-medium text-gray-900">{p.mainText}</span>
                  {p.secondaryText && <span className="block truncate text-xs text-gray-500">{p.secondaryText}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {isActive && !isLoading && available && predictions.length === 0 && (
        <p className="mt-1 px-1 text-xs text-gray-400">No matches — keep typing or pin your location on the map.</p>
      )}
      {isActive && !available && (
        <p className="mt-1 px-1 text-xs text-gray-400">Type your full address manually.</p>
      )}
    </div>
  );
}
