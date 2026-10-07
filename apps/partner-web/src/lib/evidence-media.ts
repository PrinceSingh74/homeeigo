import { apiRequestRaw } from "@/lib/api-client";

/**
 * Evidence photos are opened from where the server says they are. With object storage that is a
 * signed, short-lived link the browser can open by itself. Otherwise it is a path on the API
 * (`/api/bookings/:id/evidence/:evidenceId/media`) that only answers the signed-in reader, so it
 * has to be fetched with the session and shown from memory — a plain link would be refused.
 */
export function isApiMediaPath(url: string): boolean {
  return url.startsWith("/api/");
}

/** Opens an evidence photo in a new tab. Returns false when the server refused or it could not be read. */
export async function openEvidenceMedia(url: string): Promise<boolean> {
  if (!isApiMediaPath(url)) {
    window.open(url, "_blank", "noopener,noreferrer");
    return true;
  }
  // Open the tab inside the click, before the fetch: browsers block a window opened later.
  const tab = window.open("", "_blank");
  try {
    const res = await apiRequestRaw(url);
    if (!res.ok) throw new Error(String(res.status));
    const objectUrl = URL.createObjectURL(await res.blob());
    if (tab) tab.location.href = objectUrl;
    else window.location.assign(objectUrl);
    // The tab has its own reference once loaded; release ours after it has had time to.
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    return true;
  } catch {
    tab?.close();
    return false;
  }
}
