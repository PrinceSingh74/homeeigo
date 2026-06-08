import https from "https";
import crypto from "crypto";
import jsonwebtoken from "jsonwebtoken";

const APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys";
const APPLE_ISSUER = "https://appleid.apple.com";
const CACHE_TTL_MS = 60 * 60 * 1000;

type AppleJwk = {
  kty: string;
  kid: string;
  use?: string;
  alg?: string;
  n?: string;
  e?: string;
};

type AppleJwks = { keys: AppleJwk[] };

let cachedJwks: { keys: AppleJwk[]; fetchedAt: number } | null = null;

function fetchJson(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            reject(new Error("APPLE_JWKS_PARSE_FAILED"));
          }
        });
      })
      .on("error", reject);
  });
}

async function loadJwks(force = false): Promise<AppleJwk[]> {
  const now = Date.now();
  if (!force && cachedJwks && now - cachedJwks.fetchedAt < CACHE_TTL_MS) {
    return cachedJwks.keys;
  }
  const payload = (await fetchJson(APPLE_JWKS_URL)) as AppleJwks;
  if (!Array.isArray(payload.keys) || payload.keys.length === 0) {
    throw new Error("APPLE_JWKS_EMPTY");
  }
  cachedJwks = { keys: payload.keys, fetchedAt: now };
  return payload.keys;
}

function jwkToPem(jwk: AppleJwk): string {
  if (jwk.kty !== "RSA" || !jwk.n || !jwk.e) {
    throw new Error("APPLE_JWK_UNSUPPORTED");
  }
  const keyObject = crypto.createPublicKey({
    key: { kty: jwk.kty, n: jwk.n, e: jwk.e },
    format: "jwk",
  });
  return keyObject.export({ type: "spki", format: "pem" }).toString();
}

async function resolveSigningKey(kid: string, forceRefresh = false): Promise<string> {
  let keys = await loadJwks(forceRefresh);
  let match = keys.find((k) => k.kid === kid);
  if (!match) {
    keys = await loadJwks(true);
    match = keys.find((k) => k.kid === kid);
  }
  if (!match) throw new Error("APPLE_SIGNING_KEY_NOT_FOUND");
  return jwkToPem(match);
}

export type VerifiedAppleIdToken = {
  sub: string;
  email?: string;
  email_verified?: boolean | string;
  iss: string;
  aud: string | string[];
  exp: number;
};

/**
 * Verify an Apple ID token against Apple's JWKS (signature, iss, aud, exp).
 * Keys are cached with rotation support via forced refresh on unknown kid.
 */
export async function verifyAppleIdToken(idToken: string): Promise<VerifiedAppleIdToken> {
  const decoded = jsonwebtoken.decode(idToken, { complete: true });
  if (!decoded || typeof decoded === "string" || !decoded.header.kid) {
    throw new Error("APPLE_ID_TOKEN_MALFORMED");
  }

  const audience = process.env.APPLE_CLIENT_ID?.trim();
  if (!audience) throw new Error("APPLE_CLIENT_ID_NOT_CONFIGURED");

  let pem = await resolveSigningKey(decoded.header.kid);
  try {
    const verified = jsonwebtoken.verify(idToken, pem, {
      algorithms: ["RS256"],
      issuer: APPLE_ISSUER,
      audience,
    }) as VerifiedAppleIdToken;
    return verified;
  } catch (err) {
    if (err instanceof jsonwebtoken.JsonWebTokenError) {
      pem = await resolveSigningKey(decoded.header.kid, true);
      const verified = jsonwebtoken.verify(idToken, pem, {
        algorithms: ["RS256"],
        issuer: APPLE_ISSUER,
        audience,
      }) as VerifiedAppleIdToken;
      return verified;
    }
    throw err;
  }
}

/** Test helper — clears the in-memory JWKS cache. */
export function clearAppleJwksCacheForTests(): void {
  cachedJwks = null;
}
