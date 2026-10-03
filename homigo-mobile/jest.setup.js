/**
 * Jest setup for the customer mobile app.
 *
 * Mocks only the native modules that have no JS implementation under `jest-expo` and would
 * otherwise throw at import time. Nothing here stubs application logic — the component tests
 * exercise the real components.
 */

// Reanimated ships an official Jest mock; without it every animated component throws on import.
require("react-native-reanimated").setUpTests?.();

// AsyncStorage has no JS implementation under Jest — its NativeModule is null, so any store using
// zustand's `persist` middleware throws at import time. This is the vendor's own documented mock.
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

// expo-router's native side isn't available in the Jest environment.
jest.mock("expo-router", () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => ({}),
  usePathname: () => "/",
  Link: ({ children }) => children,
}));

// Haptics/notifications touch native APIs that don't exist under Jest.
jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  selectionAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" },
  NotificationFeedbackType: { Success: "success", Warning: "warning", Error: "error" },
}));

// Silence the RN "not wrapped in act(...)" noise that `jest-expo` emits for async state settles
// which the tests already await via waitFor.
const originalError = console.error;
console.error = (...args) => {
  if (typeof args[0] === "string" && args[0].includes("not wrapped in act(")) return;
  originalError(...args);
};

/**
 * `AiChatBlock` calls `useActiveTracking`, which pulls in react-query, the app store and live
 * booking state. The AI chat suites assert chat behaviour, not live-tracking behaviour, so the
 * hook is stubbed to its "no active booking" shape — the same state a user with no in-flight job
 * has in production.
 */
jest.mock("@/hooks/use-active-tracking", () => ({
  useActiveTracking: () => ({
    activeBooking: null,
    hasActiveBooking: false,
    tracking: null,
    isLoading: false,
  }),
}));
