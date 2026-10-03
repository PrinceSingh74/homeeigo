/**
 * Push registration through the REAL `usePushNotifications` hook (Jest; no device, no network).
 *
 * Only the leaves are stubbed: expo-notifications (the native module), the capability check, the
 * device id and the HTTP call. The expo-notifications stub reproduces the native behaviour the hook
 * has to live with: fetching a token fires the push-token listener with the NATIVE token
 * (node_modules/expo-notifications android PushTokenModule.kt resolves the fetch, then calls
 * `onNewToken`; ios PushTokenModule.swift resolves, then sends `onDevicePushToken`).
 */
import { act, renderHook, waitFor } from "@/test-utils/rntl";

type NativeToken = { type: string; data: string };
type Listener = (token: NativeToken) => void;

const mockNative = {
  permission: "granted" as "granted" | "denied" | "undetermined",
  afterRequest: "granted" as "granted" | "denied" | "undetermined",
  /** The native (FCM) token the device currently holds. */
  deviceToken: "fcm-raw:APA91bInitialDeviceToken",
  /** Expo token per native token (what exp.host returns for it). */
  expoFor: new Map<string, string>([["fcm-raw:APA91bInitialDeviceToken", "ExponentPushToken[initial-expo]"]]),
  /** Emit the native token to listeners when a token is fetched (the real module does). */
  emitOnFetch: true,
  fetchError: null as Error | null,
  listeners: new Set<Listener>(),
};

jest.mock("expo-notifications", () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(async () => ({ status: mockNative.permission })),
  requestPermissionsAsync: jest.fn(async () => {
    mockNative.permission = mockNative.afterRequest;
    return { status: mockNative.permission };
  }),
  getExpoPushTokenAsync: jest.fn(async (options?: { devicePushToken?: NativeToken }) => {
    if (mockNative.fetchError) throw mockNative.fetchError;
    const nativeToken = options?.devicePushToken ?? { type: "android", data: mockNative.deviceToken };
    if (!options?.devicePushToken && mockNative.emitOnFetch) {
      for (const l of [...mockNative.listeners]) l(nativeToken);
    }
    const data = mockNative.expoFor.get(nativeToken.data);
    if (!data) throw new Error(`exp.host does not know native token ${nativeToken.data}`);
    return { type: "expo", data };
  }),
  addPushTokenListener: jest.fn((listener: Listener) => {
    mockNative.listeners.add(listener);
    return { remove: () => mockNative.listeners.delete(listener) };
  }),
  scheduleNotificationAsync: jest.fn(),
}));

const mockCapability = { supported: true };
jest.mock("@/lib/push-notifications-capability", () => ({
  canRegisterExpoPushToken: () => mockCapability.supported,
  logExpoGoPushSkipped: jest.fn(),
}));

jest.mock("@/lib/auth/device", () => ({
  ensureDeviceId: async () => "device-test",
  getDeviceId: () => "device-test",
  getDeviceName: () => "jest",
}));

const mockRegisterPushToken = jest.fn(async (_payload: { expoPushToken: string; platform: string }) => ({
  device: {},
}));
jest.mock("@/services/core/api", () => ({
  coreApi: { users: { registerPushToken: (p: { expoPushToken: string; platform: string }) => mockRegisterPushToken(p) } },
}));

jest.mock("@/stores/auth-store", () => {
  const { create } = jest.requireActual("zustand");
  const useAuthStore = create(() => ({ status: "unauthenticated", user: null }));
  return { useAuthStore };
});

// Imported after the mocks above (jest.mock is hoisted, these requires resolve to the stubs).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { usePushNotifications } = require("./use-push-notifications");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { useAuthStore } = require("@/stores/auth-store");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Notifications = require("expo-notifications");

async function signIn(id: string) {
  await act(async () => {
    useAuthStore.setState({ status: "authenticated", user: { id } });
  });
}

async function signOutLocally() {
  await act(async () => {
    useAuthStore.setState({ status: "unauthenticated", user: null });
  });
}

async function settle(ms = 30) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

const sentTokens = () => mockRegisterPushToken.mock.calls.map((c) => c[0].expoPushToken);

let warnSpy: jest.SpyInstance;

beforeEach(async () => {
  jest.clearAllMocks();
  mockNative.permission = "granted";
  mockNative.afterRequest = "granted";
  mockNative.deviceToken = "fcm-raw:APA91bInitialDeviceToken";
  mockNative.expoFor = new Map([["fcm-raw:APA91bInitialDeviceToken", "ExponentPushToken[initial-expo]"]]);
  mockNative.emitOnFetch = true;
  mockNative.fetchError = null;
  mockNative.listeners.clear();
  mockCapability.supported = true;
  useAuthStore.setState({ status: "unauthenticated", user: null });
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const storage = require("@react-native-async-storage/async-storage");
  await (storage.default ?? storage).clear();
  // Each test is a fresh app launch: forget what the previous one registered in memory.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("@/lib/push/push-registration").pushRegistrar.forget();
  warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  warnSpy.mockRestore();
});

describe("usePushNotifications — what reaches PUT /api/users/me/devices/push-token", () => {
  it("registers the Expo token, never the native FCM/APNs token the listener is handed during the fetch", async () => {
    const hook = await renderHook(() => usePushNotifications());
    await signIn("user-a");

    await waitFor(() => expect(sentTokens()).toContain("ExponentPushToken[initial-expo]"));
    await settle();

    expect(sentTokens()).not.toContain("fcm-raw:APA91bInitialDeviceToken");
    expect(sentTokens().every((t) => /^ExponentPushToken\[/.test(t))).toBe(true);
    expect(mockRegisterPushToken.mock.calls[0][0].platform).toMatch(/^(IOS|ANDROID|WEB)$/);
    await hook.unmount();
  });

  it("a rotated native token is exchanged for its Expo token and that is re-registered", async () => {
    mockNative.emitOnFetch = false; // isolate the rotation path
    const hook = await renderHook(() => usePushNotifications());
    await signIn("user-a");
    await waitFor(() => expect(sentTokens()).toEqual(["ExponentPushToken[initial-expo]"]));

    // FCM rolls the token while the app runs.
    mockNative.deviceToken = "fcm-raw:APA91bRotatedDeviceToken";
    mockNative.expoFor.set("fcm-raw:APA91bRotatedDeviceToken", "ExponentPushToken[rotated-expo]");
    await act(async () => {
      for (const l of [...mockNative.listeners]) l({ type: "android", data: "fcm-raw:APA91bRotatedDeviceToken" });
    });

    await waitFor(() => expect(sentTokens()).toContain("ExponentPushToken[rotated-expo]"));
    await settle();
    expect(sentTokens()).not.toContain("fcm-raw:APA91bRotatedDeviceToken");
    // The rotation handler exchanged THAT token — it did not fetch the native token again.
    const lastCall = Notifications.getExpoPushTokenAsync.mock.calls.at(-1)?.[0];
    expect(lastCall?.devicePushToken?.data).toBe("fcm-raw:APA91bRotatedDeviceToken");
    await hook.unmount();
  });

  it("a different account signing in on the same phone registers the device for THAT account", async () => {
    mockNative.emitOnFetch = false;
    const hook = await renderHook(() => usePushNotifications());
    await signIn("user-a");
    await waitFor(() => expect(mockRegisterPushToken).toHaveBeenCalledTimes(1));

    await signOutLocally();
    await signIn("user-b");

    // Same physical token, new account: the server must be told, or the row stays linked to user-a
    // and user-a's pushes keep arriving on user-b's phone.
    await waitFor(() => expect(mockRegisterPushToken).toHaveBeenCalledTimes(2));
    expect(sentTokens()).toEqual(["ExponentPushToken[initial-expo]", "ExponentPushToken[initial-expo]"]);
    await hook.unmount();
  });

  it("the same account signing in again after ANY sign-out (refused refresh, log-out-everywhere) re-links the device", async () => {
    mockNative.emitOnFetch = false;
    const hook = await renderHook(() => usePushNotifications());
    await signIn("user-a");
    await waitFor(() => expect(mockRegisterPushToken).toHaveBeenCalledTimes(1));

    // The session ended without the store's logout (so no unlink ran) — e.g. "log out everywhere"
    // from another phone, which also deactivates this device server-side.
    await signOutLocally();
    await signIn("user-a");

    await waitFor(() => expect(mockRegisterPushToken).toHaveBeenCalledTimes(2));
    await hook.unmount();
  });

  it("a token fetch that throws (no Google Play services / no FCM config) is handled and reported, nothing registered", async () => {
    mockNative.fetchError = new Error("java.io.IOException: SERVICE_NOT_AVAILABLE");
    const hook = await renderHook(() => usePushNotifications());
    await signIn("user-a");
    await settle(50);

    expect(Notifications.getExpoPushTokenAsync).toHaveBeenCalled();
    expect(mockRegisterPushToken).not.toHaveBeenCalled();
    expect(warnSpy.mock.calls.some((c) => String(c[0]).includes("push registration failed at token"))).toBe(true);
    await hook.unmount();
  });

  it("permission denied: no token is fetched and nothing is registered", async () => {
    mockNative.permission = "denied";
    mockNative.afterRequest = "denied";
    const hook = await renderHook(() => usePushNotifications());
    await signIn("user-a");
    await settle(50);

    expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(Notifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
    expect(mockRegisterPushToken).not.toHaveBeenCalled();
    await hook.unmount();
  });

  it("permission undetermined: the user is asked once, and a grant registers the device", async () => {
    mockNative.permission = "undetermined";
    mockNative.afterRequest = "granted";
    const hook = await renderHook(() => usePushNotifications());
    await signIn("user-a");

    await waitFor(() => expect(sentTokens()).toContain("ExponentPushToken[initial-expo]"));
    expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    await hook.unmount();
  });

  it("Expo Go / web (no remote push support): no permission prompt, no token fetch, no registration", async () => {
    mockCapability.supported = false;
    const hook = await renderHook(() => usePushNotifications());
    await signIn("user-a");
    await settle(50);

    expect(Notifications.getPermissionsAsync).not.toHaveBeenCalled();
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(Notifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
    expect(Notifications.addPushTokenListener).not.toHaveBeenCalled();
    expect(mockRegisterPushToken).not.toHaveBeenCalled();
    await hook.unmount();
  });

  it("signed out: nothing is requested or registered", async () => {
    const hook = await renderHook(() => usePushNotifications());
    await settle(50);

    expect(Notifications.getPermissionsAsync).not.toHaveBeenCalled();
    expect(mockRegisterPushToken).not.toHaveBeenCalled();
    await hook.unmount();
  });
});
