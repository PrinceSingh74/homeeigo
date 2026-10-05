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

  it("shows the server's reason instead of the button when a report is not possible", async () => {
    cases.mockResolvedValue({ available: true, cases: [], report: { canReport: false, reason: "COMPLAINT_WINDOW_CLOSED", openCaseId: null } });
    await render(<BookingCompletionCard bookingId="b1" />);

    expect(await screen.findByTestId("booking-report-refused")).toHaveTextContent(/time to report an issue on this booking has passed/);
    expect(screen.queryByTestId("booking-report-issue")).toBeNull();
  });

  it("points to the open case, and offers details and a photo on it, instead of a second report", async () => {
    const open = {
      id: "case-1", caseNumber: "C-1001", bookingId: "b1", type: "COMPLAINT", category: "QUALITY", state: "TRIAGE",
      description: null, createdAt: "2026-09-30T10:00:00.000Z", closedAt: null,
      eligibility: { warrantyCovers: false, proofRequired: false, proofMissing: false, reasonCodes: [] },
      resolution: null, evidence: [], timeline: [],
    };
    cases.mockResolvedValue({ available: true, cases: [open], report: { canReport: false, reason: null, openCaseId: "case-1" } });
    await render(<BookingCompletionCard bookingId="b1" />);

    expect(await screen.findByTestId("booking-report-open-case")).toHaveTextContent(/case C-1001/);
    expect(screen.queryByTestId("booking-report-issue")).toBeNull();
    expect(screen.getByLabelText("Add more details to case C-1001")).toBeTruthy();
    expect(screen.getByLabelText("Add a photo to case C-1001")).toBeTruthy();

    // The two photo routes appear only once the customer asks to add one.
    expect(screen.queryByLabelText("Take a photo for case C-1001")).toBeNull();
    await fireEvent.press(screen.getByLabelText("Add a photo to case C-1001"));
    expect(await screen.findByLabelText("Take a photo for case C-1001")).toBeTruthy();
    expect(screen.getByLabelText("Choose a photo from your library for case C-1001")).toBeTruthy();
  });

  it("offers nothing to add on a closed case", async () => {
    const closed = {
      id: "case-2", caseNumber: "C-1002", bookingId: "b1", type: "COMPLAINT", category: "QUALITY", state: "RESOLVED",
      description: null, createdAt: "2026-09-30T10:00:00.000Z", closedAt: "2026-10-01T10:00:00.000Z",
      eligibility: { warrantyCovers: false, proofRequired: false, proofMissing: false, reasonCodes: [] },
      resolution: null, evidence: [], timeline: [],
    };
    cases.mockResolvedValue({ available: true, cases: [closed], report: { canReport: true, reason: null, openCaseId: null } });
    await render(<BookingCompletionCard bookingId="b1" />);

    expect(await screen.findByTestId("booking-case-C-1002")).toBeTruthy();
    expect(screen.queryByTestId("booking-case-actions")).toBeNull();
    expect(await screen.findByTestId("booking-report-issue")).toHaveTextContent("Report another issue");
  });
});
