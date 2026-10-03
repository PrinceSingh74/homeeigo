import type { BackendAddress } from "@/types/backend";

type RawAddress = Record<string, unknown>;

export function normalizeBackendAddress(raw: RawAddress): BackendAddress {
  return {
    id: String(raw.id ?? ""),
    label: (raw.label as string | null) ?? null,
    line1: String(raw.addressLine1 ?? raw.line1 ?? ""),
    line2: (raw.addressLine2 ?? raw.line2 ?? null) as string | null,
    city: (raw.city as string | null) ?? null,
    state: (raw.state as string | null) ?? null,
    pincode: String(raw.zipCode ?? raw.pincode ?? ""),
    latitude: (raw.latitude as number | null) ?? null,
    longitude: (raw.longitude as number | null) ?? null,
    isDefault: Boolean(raw.isDefault),
  };
}

/**
 * An address the customer is about to save: REAL coordinates (device GPS or a geocoded search
 * result) plus the text they confirmed. Nothing here is defaulted — the old builder filled a
 * missing PIN with "122001", a missing city with "Gurugram" and the state with "Haryana".
 */
export type AddressDraft = {
  latitude: number;
  longitude: number;
  line1: string;
  line2: string;
  city: string;
  state: string;
  pincode: string;
  label: string;
};

export type AddressDraftCheck =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; field: "line1" | "city" | "state" | "pincode" | "location"; message: string };

/** Validates a draft against the backend createAddressSchema and builds the POST body. */
export function buildAddressPayload(d: AddressDraft): AddressDraftCheck {
  if (!Number.isFinite(d.latitude) || !Number.isFinite(d.longitude)) {
    return { ok: false, field: "location", message: "Pick the location on the map or use your current location." };
  }
  const line1 = d.line1.trim();
  const line2 = d.line2.trim();
  const city = d.city.trim();
  const state = d.state.trim();
  const pincode = d.pincode.trim();
  if (line1.length < 3) return { ok: false, field: "line1", message: "Enter your house / flat number and street." };
  if (city.length < 2) return { ok: false, field: "city", message: "Enter your city." };
  if (state.length < 2) return { ok: false, field: "state", message: "Enter your state." };
  if (!/^\d{6}$/.test(pincode)) return { ok: false, field: "pincode", message: "Enter a 6-digit PIN code." };
  return {
    ok: true,
    payload: {
      label: d.label.trim() || "Home",
      addressLine1: line1.slice(0, 200),
      addressLine2: line2 ? line2.slice(0, 200) : undefined,
      city,
      state,
      zipCode: pincode,
      latitude: d.latitude,
      longitude: d.longitude,
    },
  };
}

export function formatAddressLine(addr: BackendAddress): string {
  const parts = [addr.line1, addr.line2, addr.city, addr.pincode].filter(Boolean);
  return parts.join(", ");
}
