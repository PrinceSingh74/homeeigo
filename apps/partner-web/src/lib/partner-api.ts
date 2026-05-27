const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

export async function partnerFetch<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return res.json() as Promise<T>;
}

export const partnerApi = {
  health: () => partnerFetch<{ status: string }>("/health"),
  dashboard: () =>
    partnerFetch<{ todayEarnings: number }>("/api/v1/partner/dashboard"),
  requests: () =>
    partnerFetch<{ requests: unknown[] }>("/api/v1/partner/requests"),
  acceptRequest: (id: string) =>
    partnerFetch(`/api/v1/partner/requests/${id}/accept`, { method: "POST" }),
  rejectRequest: (id: string) =>
    partnerFetch(`/api/v1/partner/requests/${id}/reject`, { method: "POST" }),
  setAvailability: (online: boolean) =>
    partnerFetch("/api/v1/partner/availability", {
      method: "PUT",
      body: JSON.stringify({ online }),
    }),
};
