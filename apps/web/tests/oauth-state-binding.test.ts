import { afterEach, describe, expect, test } from "bun:test";
import {
  beginAppleOAuth,
  consumeAppleOAuthPending,
} from "../src/lib/auth/apple-oauth";
import {
  beginGoogleOAuth,
  consumeGoogleOAuthPending,
} from "../src/lib/auth/google-oauth";

/**
 * Login-CSRF: the API state store is not bound to a browser. Only the tab that started the
 * sign-in holds the pending state, and the callback must refuse every other case before it
 * exchanges a code. These tests are that check — the component fails closed on `valid: false`.
 */
function installSessionStorage() {
  const store = new Map<string, string>();
  const sessionStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => store.clear(),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  };
  Object.defineProperty(globalThis, "sessionStorage", { value: sessionStorage, configurable: true });
  return store;
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, "sessionStorage");
});

describe("Google OAuth state is bound to the tab that started it", () => {
  test("the state this tab issued is accepted once, and the return path is kept", () => {
    installSessionStorage();
    const state = beginGoogleOAuth("/bookings/abc");
    const first = consumeGoogleOAuthPending(state);
    expect(first).toEqual({ valid: true, returnUrl: "/bookings/abc" });
    const second = consumeGoogleOAuthPending(state);
    expect(second.valid).toBe(false);
  });

  test("a state this tab did not issue is refused, including an attacker callback with no local pending", () => {
    installSessionStorage();
    const issued = beginGoogleOAuth("/");
    const mismatch = consumeGoogleOAuthPending("00000000-0000-4000-8000-000000000000");
    expect(mismatch.valid).toBe(false);
    if (!mismatch.valid) expect(mismatch.localMismatch).toBe(true);
    expect(mismatch).not.toMatchObject({ valid: true });
    // The issued state was consumed by the failed check (single-use), so it cannot be replayed.
    expect(consumeGoogleOAuthPending(issued).valid).toBe(false);

    const empty = consumeGoogleOAuthPending(issued);
    expect(empty.valid).toBe(false);
    if (!empty.valid) expect(empty.localMismatch).toBe(false);
  });

  test("an expired pending state is refused", () => {
    const store = installSessionStorage();
    const state = beginGoogleOAuth("/");
    const raw = store.get("homigo_google_oauth_pending");
    expect(raw).toBeTruthy();
    const pending = JSON.parse(raw!) as { startedAt: number };
    pending.startedAt = Date.now() - 11 * 60 * 1000;
    store.set("homigo_google_oauth_pending", JSON.stringify(pending));
    expect(consumeGoogleOAuthPending(state).valid).toBe(false);
  });

  test("a return URL cannot leave the app or loop back into auth", () => {
    installSessionStorage();
    expect(consumeGoogleOAuthPending(beginGoogleOAuth("https://evil.example/phish"))).toEqual({
      valid: true,
      returnUrl: "/",
    });
    const protocolRelative = beginGoogleOAuth("//evil.example");
    expect(consumeGoogleOAuthPending(protocolRelative)).toEqual({ valid: true, returnUrl: "/" });
    const authLoop = beginGoogleOAuth("/login?next=/wallet");
    expect(consumeGoogleOAuthPending(authLoop)).toEqual({ valid: true, returnUrl: "/" });
  });
});

describe("Apple OAuth state is bound to the tab that started it", () => {
  test("a matching state is accepted and a foreign state is refused", () => {
    installSessionStorage();
    const state = beginAppleOAuth("/wallet");
    expect(consumeAppleOAuthPending(state)).toEqual({ valid: true, returnUrl: "/wallet" });
    const foreign = beginAppleOAuth("/wallet");
    expect(consumeAppleOAuthPending("not-the-state").valid).toBe(false);
    expect(consumeAppleOAuthPending(foreign).valid).toBe(false);
  });
});
