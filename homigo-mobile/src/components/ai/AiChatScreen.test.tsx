import React from "react";
import { render, screen, fireEvent, waitFor } from "@/test-utils/rntl";
import { AiChatScreen } from "./AiChatScreen";
import { useAiChat } from "@/lib/use-ai-chat";
import { useAuthStore } from "@/stores/auth-store";

jest.mock("@/lib/use-ai-chat");
jest.mock("@/stores/auth-store");

const mockUseAiChat = useAiChat as jest.MockedFunction<typeof useAiChat>;
const mockUseAuthStore = useAuthStore as jest.MockedFunction<typeof useAuthStore>;

describe("AiChatScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockUseAuthStore.mockReturnValue({
      user: { id: "user123", firstName: "Arjun" },
      accessToken: "token123",
    } as never);
  });

  it("should render welcome message on first open", async () => {
    mockUseAiChat.mockReturnValue({
      messages: [
        {
          id: "welcome",
          role: "assistant",
          text: "Hello Arjun! How can I help with your home today?",
          time: "10:30 AM",
          quickActions: ["Book Expert", "Instant Diagnosis", "Track Booking"],
        },
      ],
      isThinking: false,
      sendText: jest.fn().mockResolvedValue(true),
      resetChat: jest.fn(),
    } as never);

    await render(<AiChatScreen />);

    expect(
      screen.getByText("Hello Arjun! How can I help with your home today?"),
    ).toBeTruthy();
  });

  it("should send user message and display assistant reply", async () => {
    const sendTextMock = jest.fn().mockResolvedValue(true);

    mockUseAiChat.mockReturnValue({
      messages: [
        {
          id: "welcome",
          role: "assistant",
          text: "Hello Arjun! How can I help with your home today?",
          time: "10:30 AM",
          quickActions: ["Book Expert", "Instant Diagnosis", "Track Booking"],
        },
      ],
      isThinking: false,
      sendText: sendTextMock,
      resetChat: jest.fn(),
    } as never);

    const { rerender } = await render(<AiChatScreen />);

    const inputField = screen.getByPlaceholderText(
      "Type your message...",
    );
    await fireEvent.changeText(inputField, "AC is not cooling");

    // Typing is not sending: the composer only sends on an explicit send.
    expect(sendTextMock).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByLabelText("Send message"));

    expect(sendTextMock).toHaveBeenCalledTimes(1);
    expect(sendTextMock).toHaveBeenCalledWith("AC is not cooling");
    // An accepted message leaves the composer empty for the next one.
    expect(screen.getByPlaceholderText("Type your message...").props.value).toBe("");

    mockUseAiChat.mockReturnValue({
      messages: [
        {
          id: "welcome",
          role: "assistant",
          text: "Hello Arjun! How can I help with your home today?",
          time: "10:30 AM",
          quickActions: ["Book Expert", "Instant Diagnosis", "Track Booking"],
        },
        {
          id: "u1",
          role: "user",
          text: "AC is not cooling",
          time: "10:31 AM",
        },
        {
          id: "a1",
          role: "assistant",
          text: "Possible airflow issue. Would you like an instant diagnosis?",
          time: "10:31 AM",
          quickActions: ["Diagnose Now", "Book Expert", "Get Estimate"],
        },
      ],
      isThinking: false,
      sendText: sendTextMock,
      resetChat: jest.fn(),
    } as never);

    await rerender(<AiChatScreen />);

    await waitFor(() => {
      expect(screen.getByText("AC is not cooling")).toBeTruthy();
      expect(screen.getByText("Possible airflow issue. Would you like an instant diagnosis?")).toBeTruthy();
    });
  });

  it("should show thinking indicator while sending", async () => {
    mockUseAiChat.mockReturnValue({
      messages: [
        {
          id: "welcome",
          role: "assistant",
          text: "Hello Arjun! How can I help with your home today?",
          time: "10:30 AM",
          quickActions: ["Book Expert", "Instant Diagnosis", "Track Booking"],
        },
      ],
      isThinking: true,
      sendText: jest.fn().mockResolvedValue(true),
      resetChat: jest.fn(),
    } as never);

    await render(<AiChatScreen />);

    expect(screen.getByLabelText("Homeeigo AI is thinking")).toBeTruthy();
  });

  it("should reset chat on reset button press", async () => {
    const resetChatMock = jest.fn();

    mockUseAiChat.mockReturnValue({
      messages: [
        {
          id: "welcome",
          role: "assistant",
          text: "Hello Arjun! How can I help with your home today?",
          time: "10:30 AM",
          quickActions: ["Book Expert", "Instant Diagnosis", "Track Booking"],
        },
        {
          id: "u1",
          role: "user",
          text: "AC is not cooling",
          time: "10:31 AM",
        },
      ],
      isThinking: false,
      sendText: jest.fn(),
      resetChat: resetChatMock,
    } as never);

    await render(<AiChatScreen />);

    const resetBtn = screen.getByLabelText("Clear chat");
    await fireEvent.press(resetBtn);

    expect(resetChatMock).toHaveBeenCalled();
  });

  it("should handle network errors gracefully", async () => {
    const sendTextMock = jest.fn().mockRejectedValue(new Error("Network error"));
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    mockUseAiChat.mockReturnValue({
      messages: [
        {
          id: "welcome",
          role: "assistant",
          text: "Hello Arjun! How can I help with your home today?",
          time: "10:30 AM",
          quickActions: ["Book Expert", "Instant Diagnosis", "Track Booking"],
        },
      ],
      isThinking: false,
      sendText: sendTextMock,
      resetChat: jest.fn(),
    } as never);

    await render(<AiChatScreen />);

    const inputField = screen.getByPlaceholderText(
      "Type your message...",
    );
    await fireEvent.changeText(inputField, "Test message");
    await fireEvent.press(screen.getByLabelText("Send message"));

    await waitFor(() => {
      expect(sendTextMock).toHaveBeenCalled();
    });
    expect(sendTextMock).toHaveBeenCalledWith("Test message");

    // The failed send is reported, not left as an unhandled promise rejection (which fails this
    // test on its own), and the screen is still there to retry from.
    await waitFor(() => {
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("send failed"),
        expect.objectContaining({ message: "Network error" }),
      );
    });
    expect(
      screen.getByText("Hello Arjun! How can I help with your home today?"),
    ).toBeTruthy();
    expect(screen.getByPlaceholderText("Type your message...")).toBeTruthy();
    warnSpy.mockRestore();
  });
});
