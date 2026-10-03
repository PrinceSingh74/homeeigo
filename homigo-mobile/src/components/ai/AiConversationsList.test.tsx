import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@/test-utils/rntl";
import { Alert } from "react-native";
import { AiConversationsList } from "./AiConversationsList";
import * as coreApi from "@/services/core/api";
import { useAuthStore } from "@/stores/auth-store";

jest.mock("@/services/core/api");

const latestConversation = coreApi.coreApi.ai.latestConversation as jest.Mock;
const deleteConversation = coreApi.coreApi.ai.deleteConversation as jest.Mock;

/** Signs an account in the same way the app does: by putting it in the auth store. */
function signIn(id: string) {
  useAuthStore.setState({ user: { id, firstName: "Test" } as never });
}

describe("AiConversationsList", () => {
  const mockOnSelectConversation = jest.fn();
  const mockOnDelete = jest.fn();
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    // clearAllMocks keeps implementations, so a resolved value queued by one test would answer
    // the next test's request. Reset the two API mocks explicitly — not resetAllMocks, which
    // would also strip the AsyncStorage mock the auth store persists through.
    latestConversation.mockReset();
    deleteConversation.mockReset();
    alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    signIn("user-123");
  });

  afterEach(() => {
    alertSpy.mockRestore();
    useAuthStore.setState({ user: null });
  });

  it("should display empty state when no conversations", async () => {
    latestConversation.mockResolvedValue(null);

    await render(
      <AiConversationsList
        onSelectConversation={mockOnSelectConversation}
        onDelete={mockOnDelete}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("No conversations yet")).toBeTruthy();
      expect(screen.getByText("Start chatting to see your history here")).toBeTruthy();
    });
  });

  it("should load and display conversation", async () => {
    latestConversation.mockResolvedValue({
      id: "conv123",
      title: "AC Service Inquiry",
      messages: [
        { id: "m1", role: "user", content: "AC not cooling", createdAt: new Date().toISOString() },
        {
          id: "m2",
          role: "assistant",
          content: "I can help with that",
          createdAt: new Date().toISOString(),
        },
      ],
    });

    await render(
      <AiConversationsList
        onSelectConversation={mockOnSelectConversation}
        onDelete={mockOnDelete}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("AC Service Inquiry")).toBeTruthy();
      expect(screen.getByText(/2 messages/)).toBeTruthy();
    });
  });

  it("should select conversation on press", async () => {
    latestConversation.mockResolvedValue({
      id: "conv123",
      title: "AC Service",
      messages: [
        { id: "m1", role: "user", content: "Test", createdAt: new Date().toISOString() },
      ],
    });

    await render(
      <AiConversationsList
        onSelectConversation={mockOnSelectConversation}
        onDelete={mockOnDelete}
      />,
    );

    await fireEvent.press(await screen.findByText("AC Service"));

    expect(mockOnSelectConversation).toHaveBeenCalledTimes(1);
    expect(mockOnSelectConversation).toHaveBeenCalledWith("conv123");
  });

  it("should delete conversation after confirmation", async () => {
    latestConversation.mockResolvedValue({
      id: "conv123",
      title: "AC Service",
      messages: [
        { id: "m1", role: "user", content: "Test", createdAt: new Date().toISOString() },
      ],
    });

    deleteConversation.mockResolvedValue({ success: true });

    await render(
      <AiConversationsList
        onSelectConversation={mockOnSelectConversation}
        onDelete={mockOnDelete}
      />,
    );

    await fireEvent.press(await screen.findByLabelText("Delete conversation"));

    expect(Alert.alert).toHaveBeenCalledWith(
      "Delete conversation",
      "This action cannot be undone.",
      expect.any(Array),
    );

    // Asking is not deleting: nothing may be removed until the destructive button is pressed.
    expect(deleteConversation).not.toHaveBeenCalled();
    expect(mockOnDelete).not.toHaveBeenCalled();

    const buttons = alertSpy.mock.calls[0][2] as Array<{
      text: string;
      style?: string;
      onPress?: () => Promise<void> | void;
    }>;
    const confirm = buttons.find((b) => b.style === "destructive");
    expect(confirm?.text).toBe("Delete");

    await act(async () => {
      await confirm?.onPress?.();
    });

    expect(deleteConversation).toHaveBeenCalledWith("conv123");
    expect(mockOnDelete).toHaveBeenCalledWith("conv123");
    expect(screen.queryByText("AC Service")).toBeNull();
    expect(screen.getByText("No conversations yet")).toBeTruthy();
  });

  it("should handle API errors", async () => {
    // The component reports the failure with console.error; keep it out of the test output
    // while still proving it was reported.
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    latestConversation.mockRejectedValue(new Error("Network error"));

    await render(
      <AiConversationsList
        onSelectConversation={mockOnSelectConversation}
        onDelete={mockOnDelete}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Failed to load conversations")).toBeTruthy();
    });
    expect(errorSpy).toHaveBeenCalledWith(expect.objectContaining({ message: "Network error" }));
    errorSpy.mockRestore();
  });

  it("should show relative timestamps", async () => {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 3600000);

    latestConversation.mockResolvedValue({
      id: "conv123",
      title: "Test",
      messages: [],
      updatedAt: oneHourAgo.toISOString(),
    });

    await render(
      <AiConversationsList
        onSelectConversation={mockOnSelectConversation}
        onDelete={mockOnDelete}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/1h ago/)).toBeTruthy();
    });
    expect(screen.queryByText(/just now/)).toBeNull();
  });

  it("should date a conversation by its newest message when the server sends no updatedAt", async () => {
    // This is the shape `/api/ai/conversations/latest` returns today: no `updatedAt`.
    const now = Date.now();
    latestConversation.mockResolvedValue({
      id: "conv123",
      title: "Test",
      messages: [
        {
          id: "m1",
          role: "user",
          content: "First",
          createdAt: new Date(now - 3 * 86400000).toISOString(),
        },
        {
          id: "m2",
          role: "assistant",
          content: "Last",
          createdAt: new Date(now - 2 * 3600000).toISOString(),
        },
      ],
    });

    await render(
      <AiConversationsList
        onSelectConversation={mockOnSelectConversation}
        onDelete={mockOnDelete}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/2 messages • 2h ago/)).toBeTruthy();
    });
  });

  it("should not invent a timestamp when the server sends none", async () => {
    latestConversation.mockResolvedValue({
      id: "conv123",
      title: "Test",
      messages: [{ id: "m1", role: "user", content: "Hi", createdAt: "" }],
    });

    await render(
      <AiConversationsList
        onSelectConversation={mockOnSelectConversation}
        onDelete={mockOnDelete}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/1 messages/)).toBeTruthy();
    });
    expect(screen.queryByText(/just now|ago|Invalid Date/)).toBeNull();
  });

  it("should isolate conversations per user", async () => {
    // The server answers for whoever is signed in, exactly as the authenticated endpoint does.
    latestConversation.mockImplementation(() => {
      const id = useAuthStore.getState().user?.id;
      if (id === "user-123") {
        return Promise.resolve({ id: "conv-user123", title: "User 1 Conversation", messages: [] });
      }
      if (id === "user-456") {
        return Promise.resolve({ id: "conv-user456", title: "User 2 Conversation", messages: [] });
      }
      return Promise.resolve(null);
    });

    await render(
      <AiConversationsList
        onSelectConversation={mockOnSelectConversation}
        onDelete={mockOnDelete}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("User 1 Conversation")).toBeTruthy();
    });

    // A different account signs in while the list is still mounted.
    await act(() => {
      signIn("user-456");
    });

    await waitFor(() => {
      expect(screen.getByText("User 2 Conversation")).toBeTruthy();
      expect(screen.queryByText("User 1 Conversation")).toBeFalsy();
    });
    expect(latestConversation).toHaveBeenCalledTimes(2);
  });

  it("should discard a response that arrives after the account changed", async () => {
    let answerFirstAccount: (value: unknown) => void = () => {};
    latestConversation
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            answerFirstAccount = resolve;
          }),
      )
      .mockResolvedValueOnce({ id: "conv-user456", title: "User 2 Conversation", messages: [] });

    await render(
      <AiConversationsList
        onSelectConversation={mockOnSelectConversation}
        onDelete={mockOnDelete}
      />,
    );

    await act(() => {
      signIn("user-456");
    });

    await waitFor(() => {
      expect(screen.getByText("User 2 Conversation")).toBeTruthy();
    });

    // The first account's request finally answers — after that account is gone.
    await act(async () => {
      answerFirstAccount({ id: "conv-user123", title: "User 1 Conversation", messages: [] });
    });

    expect(screen.queryByText("User 1 Conversation")).toBeNull();
    expect(screen.getByText("User 2 Conversation")).toBeTruthy();
  });

  it("should clear the previous account's conversations on sign-out", async () => {
    latestConversation.mockResolvedValue({
      id: "conv-user123",
      title: "User 1 Conversation",
      messages: [],
    });

    await render(
      <AiConversationsList
        onSelectConversation={mockOnSelectConversation}
        onDelete={mockOnDelete}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("User 1 Conversation")).toBeTruthy();
    });

    await act(() => {
      useAuthStore.setState({ user: null });
    });

    await waitFor(() => {
      expect(screen.getByText("No conversations yet")).toBeTruthy();
    });
    expect(screen.queryByText("User 1 Conversation")).toBeNull();
    // No account, so the authenticated endpoint is not asked again.
    expect(latestConversation).toHaveBeenCalledTimes(1);
  });
});
