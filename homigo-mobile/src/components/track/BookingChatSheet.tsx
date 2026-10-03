import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Send, X } from "lucide-react-native";
import { coreApi } from "@/services/core/api";
import { useAuthStore } from "@/stores/auth-store";

type ChatMessage = {
  id: string;
  body: string;
  senderUserId: string;
  createdAt: string;
  clientMessageId?: string | null;
};

/**
 * Customer mobile booking chat — same `/api/bookings/:id/chat` conversation
 * as Customer Web and Partner Web/Mobile. No second chat backend.
 */
export function BookingChatSheet({
  visible,
  bookingId,
  partnerName,
  onClose,
}: {
  visible: boolean;
  bookingId: string;
  partnerName?: string | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const myUserId = useAuthStore((s) => s.user?.id);
  const [draft, setDraft] = useState("");
  const [pendingClientId, setPendingClientId] = useState<string | null>(null);
  const listRef = useRef<FlatList<ChatMessage>>(null);

  const chatQuery = useQuery({
    queryKey: ["customer-mobile", "job-chat", bookingId],
    queryFn: () => coreApi.bookings.listChat(bookingId, { limit: 50 }),
    enabled: visible && Boolean(bookingId),
    refetchInterval: visible ? 8_000 : false,
  });

  useEffect(() => {
    if (!visible || !bookingId) return;
    void coreApi.bookings.markChatRead(bookingId).catch(() => undefined);
  }, [visible, bookingId, chatQuery.dataUpdatedAt]);

  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
    return () => clearTimeout(t);
  }, [visible, chatQuery.data?.messages.length]);

  const sendMutation = useMutation({
    mutationFn: async (body: string) => {
      const clientMessageId = pendingClientId ?? `cust-mobile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setPendingClientId(clientMessageId);
      return coreApi.bookings.sendChat(bookingId, body, clientMessageId);
    },
    onSuccess: () => {
      setDraft("");
      setPendingClientId(null);
      void qc.invalidateQueries({ queryKey: ["customer-mobile", "job-chat", bookingId] });
    },
  });

  const messages = [...(chatQuery.data?.messages ?? [])].reverse();

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close chat" />
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.sheet}
        >
          <View style={styles.grabber} />
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Chat with {partnerName?.trim() || "your pro"}</Text>
              <Text style={styles.subtitle}>Private to this booking</Text>
            </View>
            <Pressable
              onPress={onClose}
              style={styles.closeBtn}
              accessibilityRole="button"
              accessibilityLabel="Close chat"
            >
              <X size={18} color="#0f172a" />
            </Pressable>
          </View>

          {chatQuery.isLoading ? (
            <View style={styles.center}>
              <ActivityIndicator color="#0d9488" />
            </View>
          ) : chatQuery.isError ? (
            <View style={styles.center}>
              <Text style={styles.error}>Couldn’t load messages. Pull to retry.</Text>
              <Pressable onPress={() => void chatQuery.refetch()} style={styles.retryBtn}>
                <Text style={styles.retryText}>Retry</Text>
              </Pressable>
            </View>
          ) : (
            <FlatList keyboardShouldPersistTaps="handled"
              ref={listRef}
              data={messages}
              keyExtractor={(m) => m.id}
              contentContainerStyle={styles.list}
              onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
              ListEmptyComponent={
                <Text style={styles.empty}>No messages yet — say hello to your pro.</Text>
              }
              renderItem={({ item }) => {
                const mine = myUserId != null && item.senderUserId === myUserId;
                return (
                  <View style={[styles.bubbleWrap, mine ? styles.mine : styles.theirs]}>
                    <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                      <Text style={[styles.body, mine ? styles.bodyMine : styles.bodyTheirs]}>
                        {item.body}
                      </Text>
                    </View>
                    <Text style={styles.time}>
                      {new Date(item.createdAt).toLocaleTimeString("en-IN", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </Text>
                  </View>
                );
              }}
            />
          )}

          <View style={styles.composer}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Type a message…"
              placeholderTextColor="#94a3b8"
              maxLength={2000}
              style={styles.input}
              accessibilityLabel="Message"
            />
            <Pressable
              onPress={() => {
                const body = draft.trim();
                if (!body || sendMutation.isPending) return;
                sendMutation.mutate(body);
              }}
              disabled={!draft.trim() || sendMutation.isPending}
              style={[styles.sendBtn, (!draft.trim() || sendMutation.isPending) && styles.sendDisabled]}
              accessibilityRole="button"
              accessibilityLabel="Send message"
            >
              {sendMutation.isPending ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Send size={16} color="#fff" />
              )}
            </Pressable>
          </View>
          {sendMutation.isError ? (
            <Pressable
              onPress={() => {
                const body = draft.trim();
                if (body) sendMutation.mutate(body);
              }}
              style={styles.errorBar}
            >
              <Text style={styles.errorBarText}>Send failed — tap to retry safely</Text>
            </Pressable>
          ) : null}
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(15,23,42,0.45)" },
  sheet: {
    maxHeight: "78%",
    minHeight: "52%",
    backgroundColor: "#fff",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingBottom: Platform.OS === "ios" ? 18 : 12,
  },
  grabber: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 999,
    backgroundColor: "#e2e8f0",
    marginTop: 10,
    marginBottom: 8,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 18,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
  },
  title: { fontSize: 16, fontWeight: "800", color: "#0f172a" },
  subtitle: { fontSize: 11.5, fontWeight: "600", color: "#64748b", marginTop: 2 },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: "#f1f5f9",
    alignItems: "center",
    justifyContent: "center",
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 24 },
  error: { color: "#b91c1c", fontSize: 13, fontWeight: "600", textAlign: "center" },
  retryBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: "#ecfdf5",
  },
  retryText: { color: "#047857", fontWeight: "700", fontSize: 13 },
  list: { paddingHorizontal: 16, paddingVertical: 12, gap: 8, flexGrow: 1 },
  empty: { textAlign: "center", color: "#94a3b8", fontSize: 13, marginTop: 40 },
  bubbleWrap: { marginBottom: 8, maxWidth: "82%" },
  mine: { alignSelf: "flex-end", alignItems: "flex-end" },
  theirs: { alignSelf: "flex-start", alignItems: "flex-start" },
  bubble: { borderRadius: 16, paddingHorizontal: 12, paddingVertical: 9 },
  bubbleMine: { backgroundColor: "#0d9488" },
  bubbleTheirs: { backgroundColor: "#f1f5f9", borderWidth: 1, borderColor: "#e2e8f0" },
  body: { fontSize: 14, lineHeight: 19 },
  bodyMine: { color: "#fff", fontWeight: "600" },
  bodyTheirs: { color: "#0f172a", fontWeight: "500" },
  time: { fontSize: 10, color: "#94a3b8", marginTop: 3 },
  composer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "#f1f5f9",
  },
  input: {
    flex: 1,
    minHeight: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "#f8fafc",
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: "#0f172a",
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: "#0d9488",
    alignItems: "center",
    justifyContent: "center",
  },
  sendDisabled: { opacity: 0.4 },
  errorBar: { paddingHorizontal: 16, paddingTop: 6 },
  errorBarText: { color: "#b91c1c", fontSize: 12, fontWeight: "600" },
});
