/**
 * Soft GPS for en-route (may fall back to 0,0). Arrive/start still prefer live
 * GPS, but permission/timeout never blocks the click — the server owns the
 * proximity gate (and may bypass it for pinned demo partners).
 */
export async function getPartnerCoords(
  _mode: "soft" | "strict" = "soft",
): Promise<{ latitude: number; longitude: number }> {
  return new Promise((resolve) => {
    const fallback = { latitude: 0, longitude: 0 };
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve(fallback);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        if (latitude === 0 && longitude === 0) {
          resolve(fallback);
          return;
        }
        resolve({ latitude, longitude });
      },
      () => resolve(fallback),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30_000 },
    );
  });
}
