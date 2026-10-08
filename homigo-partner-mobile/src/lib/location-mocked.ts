/**
 * The mock-location signal, as the OS gives it.
 *
 * Android marks every fix that came from a mock provider (a fake-GPS app) with `mocked: true`
 * (expo-location `LocationObject.mocked` — on the fix itself, not on its `coords`). The server stores the flag with the fix and does
 * not treat a mocked fix as proof of where the partner is (apps/backend/src/lib/arrival-position.ts).
 *
 * The app only passes the OS's word on. iOS, the web and older systems say nothing, and that must
 * reach the server as nothing: defaulting to `false` would tell the server "the OS vouches for this
 * fix" when nobody did.
 *
 * This is the device's own word, not attestation — a tampered app can send `false`. It closes the
 * ordinary case (an off-the-shelf fake-GPS app), not a modified client.
 */
export function mockedField(fix: { mocked?: boolean | null } | null | undefined): { mocked?: boolean } {
  return typeof fix?.mocked === "boolean" ? { mocked: fix.mocked } : {};
}

/** The body fields a lifecycle call carries for its position. */
export type PositionBody = { latitude: number | null; longitude: number | null; mocked?: boolean };

/**
 * The position a lifecycle call carries (arrive / start / the on-site check): null coordinates
 * when there is no fix, and the OS's mocked flag only when it said something — never a default.
 * The server-held fix decides; the flag on the request is on record as the device's own admission.
 */
export function positionBody(c: { latitude: number; longitude: number; mocked?: boolean | null } | null | undefined): PositionBody {
  if (!c) return { latitude: null, longitude: null };
  return { latitude: c.latitude, longitude: c.longitude, ...mockedField(c) };
}
