/**
 * "Is this page on its way out?" — for code that must not treat navigation-induced aborts as failures.
 *
 * When the user navigates or reloads while lazy chunks or fetches are still in flight, the browser
 * aborts them, and the outgoing page still sees the rejections: webpack reports a ChunkLoadError and
 * fetch rejects with "Failed to fetch". Treating those as real failures did damage: ChunkLoadRecovery
 * answered with its own window.location.reload(), which cancelled the navigation the user had just
 * started (Playwright: "page.reload: net::ERR_ABORTED; frame was detached"), and the API client
 * logged "[auth] backend unreachable" while the backend answered every request with 200.
 *
 * `beforeunload` fires first; if the navigation then does not happen (a download, a mailto: link)
 * the flag clears itself, so a page that stays is never left believing it is leaving.
 */
let leaving = false;
let resetTimer: ReturnType<typeof setTimeout> | null = null;

function markLeaving() {
  leaving = true;
  if (resetTimer) clearTimeout(resetTimer);
  // A page that really unloads stops running JS long before this fires.
  resetTimer = setTimeout(() => {
    leaving = false;
  }, 3_000);
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", markLeaving);
  window.addEventListener("pagehide", markLeaving);
  window.addEventListener("pageshow", () => {
    leaving = false; // restored from the back/forward cache
  });
}

export function isPageLeaving(): boolean {
  return leaving;
}
