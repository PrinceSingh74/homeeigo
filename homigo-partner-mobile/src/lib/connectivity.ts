/**
 * Whether the app can reach the server, derived from what its own requests experienced.
 *
 * There is no NetInfo package in this app, and React Query's `onlineManager` cannot stand in for it
 * on a phone: it listens to `window` "online" / "offline" events, which React Native does not have,
 * so it reports "online" forever. The only evidence available is the requests themselves:
 *  - a request that got NO HTTP answer (`NETWORK_ERROR`) means the server is unreachable now;
 *  - ANY HTTP answer — a success or a refusal — means it is reachable.
 * The state therefore follows the latest request. It is a statement about reaching HOMEEIGO, not
 * about the phone's radio: it clears on the next answered request.
 *
 * Pure (no import), so the rule is unit-tested.
 */
export type ConnectivityState = {
  offline: boolean;
  /** Device time (ms) of the first unanswered request of the current outage; null while online. */
  since: number | null;
};

export type RequestOutcome = "answered" | "no-answer";

export const CONNECTED: ConnectivityState = { offline: false, since: null };

export function nextConnectivity(prev: ConnectivityState, outcome: RequestOutcome, atMs: number): ConnectivityState {
  if (outcome === "answered") return prev.offline ? CONNECTED : prev;
  return prev.offline ? prev : { offline: true, since: atMs };
}

/** What a settled request says about reachability. `error` is undefined / null for a success. */
export function outcomeOf(error: unknown): RequestOutcome {
  if (error == null) return "answered";
  const e = error as { name?: unknown; status?: unknown; code?: unknown };
  const unanswered = error instanceof Error && e.name === "PartnerApiError" && e.status === 0 && e.code === "NETWORK_ERROR";
  return unanswered ? "no-answer" : "answered";
}
