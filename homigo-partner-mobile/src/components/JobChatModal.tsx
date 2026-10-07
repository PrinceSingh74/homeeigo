import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageCircle, Send, X } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Modal, Pressable, StyleSheet, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PanelError } from "@/components/job/parts";
import { Banner, Button, EmptyState, Skeleton, T } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { chatBubble, failureSentence } from "@/lib/job-screen";
import { CHAT_CLOSED_MESSAGE, isChatClosedError, isChatOpen } from "@/lib/job-stage";
import { partnerApi } from "@/services/partner-api";
import { useAuthStore } from "@/stores/auth-store";
import { color, radius, space, touch, type } from "@/theme/tokens";
import type { JobChatMessage } from "@/types/partner";

const MESSAGE_MAX = 2000;

/**
 * Chat with the customer of ONE job, for as long as the partner is serving it.
 *
 * The server closes chat (403 `CHAT_CLOSED`) once the job is not active. `status` lets the screen
 * know that without asking: when chat is closed nothing is read, nothing is marked read, there is no
 * composer, and the screen says "Chat is closed for this job." A `CHAT_CLOSED` that arrives anyway
 * (the job ended while this was open) shows the same sentence — never an empty chat.
 *
 * Bubbles are the partner's own (right, leaf) or the customer's (left); each has its time, and the
 * partner's own carry "Sent", "Delivered" or "Read" from `deliveredAt` / `readAt` as the server sends
 * them. A message that could not be sent stays in the composer with the server's sentence and
 * "Try again", which re-sends it under the same id so it cannot be delivered twice.
 */
export function JobChatModal({
  bookingId,
  status,
  customerName,
  bookingNumber,
  phoneMasked,
  visible,
  onClose,
}: {
  bookingId: string;
  /** The booking's status — decides whether chat is open (`isChatOpen`). */
  status: string | null | undefined;
  customerName: string;
  bookingNumber: string;
  phoneMasked?: string | null;
  visible: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const myUserId = useAuthStore((s) => s.user?.id ?? null);
  const [draft, setDraft] = useState("");
  const listRef = useRef<FlatList<JobChatMessage>>(null);
  const open = isChatOpen(status);

  const chat = useQuery({
    queryKey: ["partner", "job-chat", bookingId],
    queryFn: () => partnerApi.listChat(bookingId, { limit: 50 }),
    enabled: visible && open,
    // Stop polling the moment the server says the chat is closed.
    refetchInterval: (query) => (!visible || isChatClosedError(query.state.error) ? false : 8_000),
    retry: (count, error) => !isChatClosedError(error) && count < 2,
  });

  useEffect(() => {
    if (!visible || !open || !chat.isSuccess) return;
    void partnerApi.markChatRead(bookingId).catch(() => undefined);
  }, [visible, open, bookingId, chat.isSuccess, chat.dataUpdatedAt]);

  const send = useMutation({
    // One id per message: a retry of the same text re-uses it, and the server answers with the row it already has.
    mutationFn: (vars: { body: string; clientMessageId: string }) => partnerApi.sendChat(bookingId, vars.body, vars.clientMessageId),
    onSuccess: () => {
      setDraft("");
      return qc.invalidateQueries({ queryKey: ["partner", "job-chat", bookingId] });
    },
  });

  const closed = !open || isChatClosedError(chat.error) || isChatClosedError(send.error);
  const messages = closed ? [] : (chat.data?.messages ?? []);
  const body = draft.trim();
  const canSend = body.length > 0 && !send.isPending;
  const failed = send.isError && !isChatClosedError(send.error) ? send.variables : undefined;

  function submit() {
    if (!canSend) return;
    // Re-sending the text that just failed keeps its id; a new or edited text gets a new one.
    const clientMessageId = failed && failed.body === body ? failed.clientMessageId : `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    send.mutate({ body, clientMessageId });
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
        <KeyboardAvoidingView style={styles.flex} behavior="padding">
          <View style={styles.header}>
            <View style={styles.flex}>
              <T kind="heading" accessibilityRole="header" numberOfLines={1}>
                {customerName}
              </T>
              <T kind="small" numberOfLines={1}>
                {phoneMasked ? `${bookingNumber} · ${phoneMasked}` : bookingNumber}
              </T>
            </View>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close chat" testID="job-chat-close" style={({ pressed }) => [styles.close, pressed ? styles.pressed : null]}>
              <X color={color.leaf} size={22} />
            </Pressable>
          </View>

          {closed ? (
            <EmptyState icon={MessageCircle} title={CHAT_CLOSED_MESSAGE} message="You can message the customer only while the job is active." testID="job-chat-closed" />
          ) : chat.isLoading ? (
            <View style={styles.loading} accessible accessibilityRole="progressbar" accessibilityLabel="Loading messages">
              <Skeleton height={40} width="60%" />
              <Skeleton height={40} width="45%" style={styles.right} />
              <Skeleton height={40} width="70%" />
            </View>
          ) : chat.isError && !chat.data ? (
            <View style={styles.pad}>
              <PanelError error={chat.error} onRetry={() => void chat.refetch()} retrying={chat.isFetching} testID="job-chat-error" />
            </View>
          ) : (
            <FlatList
              ref={listRef}
              data={messages}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.list}
              keyboardShouldPersistTaps="handled"
              onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
              ListEmptyComponent={<EmptyState icon={MessageCircle} title="No messages yet" message="Messages you and the customer send about this job appear here." testID="job-chat-empty" />}
              renderItem={({ item }) => {
                const bubble = chatBubble(item, myUserId);
                const time = formatDateTime(item.createdAt);
                return (
                  <View
                    style={[styles.row, bubble.mine ? styles.rowMine : styles.rowTheirs]}
                    accessible
                    accessibilityLabel={`${bubble.mine ? "You" : customerName}: ${item.body}. ${time}${bubble.receipt ? `. ${bubble.receipt}` : ""}`}
                  >
                    <View style={[styles.bubble, bubble.mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                      <T kind="body" tone={bubble.mine ? "onLeaf" : "ink"}>
                        {item.body}
                      </T>
                    </View>
                    <T kind="caption" numeric>
                      {bubble.receipt ? `${time} · ${bubble.receipt}` : time}
                    </T>
                  </View>
                );
              }}
            />
          )}

          {closed ? null : (
            <View style={styles.composerWrap}>
              {failed ? (
                <Banner
                  tone="danger"
                  testID="job-chat-send-error"
                  title="Message not sent"
                  message={failureSentence(send.error, "Your message could not be sent.")}
                  action={<Button label="Try again" variant="secondary" onPress={submit} disabled={!canSend} testID="job-chat-retry" />}
                />
              ) : null}
              <T kind="smallStrong" tone="slate" nativeID="job-chat-label">
                Message to the customer
              </T>
              <View style={styles.composer}>
                <TextInput
                  testID="job-chat-input"
                  value={draft}
                  onChangeText={setDraft}
                  maxLength={MESSAGE_MAX}
                  multiline
                  accessibilityLabel="Message to the customer"
                  accessibilityLabelledBy="job-chat-label"
                  placeholder="Write a message"
                  placeholderTextColor={color.mist}
                  style={styles.input}
                />
                <Pressable
                  testID="job-chat-send"
                  onPress={submit}
                  disabled={!canSend}
                  accessibilityRole="button"
                  accessibilityLabel="Send message"
                  accessibilityState={{ disabled: !canSend, busy: send.isPending }}
                  style={({ pressed }) => [styles.send, pressed ? styles.sendPressed : null, !canSend ? styles.sendOff : null]}
                >
                  {send.isPending ? <ActivityIndicator color={color.onLeaf} /> : <Send color={color.onLeaf} size={20} />}
                </Pressable>
              </View>
            </View>
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.paper },
  flex: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.xl, paddingVertical: space.md, backgroundColor: color.surface, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.line },
  close: { width: touch.min, height: touch.min, borderRadius: radius.control, alignItems: "center", justifyContent: "center" },
  pressed: { backgroundColor: color.well },
  loading: { flex: 1, padding: space.xl, gap: space.md },
  right: { alignSelf: "flex-end" },
  pad: { flex: 1, padding: space.xl },
  list: { flexGrow: 1, padding: space.xl, gap: space.md },
  row: { maxWidth: "86%", gap: 2 },
  rowMine: { alignSelf: "flex-end", alignItems: "flex-end" },
  rowTheirs: { alignSelf: "flex-start", alignItems: "flex-start" },
  bubble: { borderRadius: radius.card, paddingHorizontal: space.lg, paddingVertical: space.md, borderWidth: 1 },
  bubbleMine: { backgroundColor: color.leaf, borderColor: color.leaf },
  bubbleTheirs: { backgroundColor: color.surface, borderColor: color.line },
  composerWrap: { gap: space.sm, paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: space.md, backgroundColor: color.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: space.sm },
  input: { ...type.body, flex: 1, minHeight: touch.min, maxHeight: touch.min * 3, borderWidth: 1, borderColor: color.line, borderRadius: radius.control, backgroundColor: color.surface, paddingHorizontal: space.lg, paddingVertical: space.md },
  send: { width: touch.min + 4, height: touch.min + 4, borderRadius: radius.control, backgroundColor: color.leaf, alignItems: "center", justifyContent: "center" },
  sendPressed: { backgroundColor: color.leafPressed },
  sendOff: { opacity: 0.5 },
});
