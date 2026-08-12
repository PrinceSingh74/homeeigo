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

function inferState(city: string): string {
  const c = city.toLowerCase();
  if (c.includes("noida") || c.includes("ghaziabad")) return "Uttar Pradesh";
  if (c.includes("delhi")) return "Delhi";
  if (c.includes("gurugram") || c.includes("gurgaon") || c.includes("faridabad")) return "Haryana";
  return "Haryana";
}

/** Maps book-page address fields to POST /api/users/addresses body. */
export function buildAddressCreatePayload(input: {
  line1: string;
  line2: string;
  label?: string;
  latitude: number;
  longitude: number;
}) {
  const line1 = input.line1.trim();
  const line2 = input.line2.trim();
  const pinMatch = line2.match(/\b(\d{6})\b/);
  const zipCode = pinMatch?.[1] ?? "122001";
  const city = line2.split(",")[0]?.trim() || "Gurugram";

  return {
    label: input.label ?? "Home",
    addressLine1: line1,
    addressLine2: line2 || undefined,
    city,
    state: inferState(city),
    zipCode,
    latitude: input.latitude,
    longitude: input.longitude,
  };
}
