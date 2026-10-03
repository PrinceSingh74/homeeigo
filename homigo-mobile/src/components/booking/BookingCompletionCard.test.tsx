import React from "react";
import { Keyboard, Platform, StyleSheet } from "react-native";
import { render, screen, fireEvent, act, waitFor } from "@/test-utils/rntl";
import { BookingCompletionCard } from "./BookingCompletionCard";
import * as coreApi from "@/services/core/api";

jest.mock("@/services/core/api");

const completion = coreApi.coreApi.bookings.completion as jest.Mock;
const cases = coreApi.coreApi.bookings.cases as jest.Mock;

type KeyboardListener = (e: unknown) => void;

describe("BookingCompletionCard — report an issue", () => {
  let listeners: Record<string, KeyboardListener[]>;
  let addListener: jest.SpyInstance;

  beforeEach(() => {
    completion.mockReset();
    cases.mockReset();
    completion.mockResolvedValue({
      completion: { state: "PENDING_CUSTOMER", confirmBy: "2026-09-30T18:00:00.000Z", caseId: null },
      verdict: null,
      warranty: null,
    });
    cases.mockResolvedValue({ available: true, cases: [] });
    listeners = {};
    addListener = jest.spyOn(Keyboard, "addListener").mockImplementation(((event: string, fn: KeyboardListener) => {
      (listeners[event] ??= []).push(fn);
      return { remove: () => undefined } as never;
    }) as never);
  });

  afterEach(() => {
    addListener.mockRestore();
    jest.restoreAllMocks();
  });

  it("lifts the description field and the submit button above the Android soft keyboard", async () => {
    // Found on the Android emulator: the report modal is statusBarTranslucent, the window is not
    // resized by the keyboard, and the typed description and "Report issue" sat under it.
    jest.replaceProperty(Platform, "OS", "android");
    await render(<BookingCompletionCard bookingId="b1" />);
    await fireEvent.press(await screen.findByTestId("booking-report-issue"));

    const avoider = await screen.findByTestId("case-report-keyboard-avoider");
    expect(avoider).toContainElement(screen.getByTestId("case-description"));
    expect(avoider).toContainElement(screen.getByTestId("case-submit"));

    // Full-screen modal: 2400 px tall; the keyboard covers everything below y = 1500.
    await act(async () => {
      fireEvent(avoider, "layout", { persist: () => undefined, nativeEvent: { layout: { x: 0, y: 0, width: 1080, height: 2400 } } });
    });
    expect(listeners.keyboardDidShow?.length ?? 0).toBeGreaterThan(0);
    await act(async () => {
      for (const fn of listeners.keyboardDidShow ?? []) {
        fn({ duration: 0, easing: "keyboard", endCoordinates: { screenX: 0, screenY: 1500, width: 1080, height: 900 } });
      }
    });
    await waitFor(() =>
      expect(StyleSheet.flatten(screen.getByTestId("case-report-keyboard-avoider").props.style).paddingBottom).toBe(900),
    );
  });
});
