import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
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
import { partnerApi } from "@/services/partner-api";
import { partnerColors } from "@/theme/colors";

export function JobChatModal({
  bookingId,
  customerName,
  bookingNumber,
  phoneMasked,
  visible,
  onClose,
}: {
  bookingId: string;
  customerName: string;
  bookingNumber: string;
  phoneMasked?: string | null;
  visible: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState("");

  const chat = useQuery({
    queryKey: ["partner", "job-chat", bookingId],
    queryFn: () => partnerApi.listChat(bookingId, { limit: 50 }),
    enabled: visible,
    refetchInterval: visible ? 8_000 : false,
  });

  useEffect(() => {
    if (!visible) return;
    void partnerApi.markChatRead(bookingId).catch(() => undefined);
  }, [visible, bookingId, chat.dataUpdatedAt]);

  const send = useMutation({
    mutationFn: (body: string) => partnerApi.sendChat(bookingId, body, `m-${Date.now()}`),
    onSuccess: () => {
      setDraft("");
      void qc.invalidateQueries({ queryKey: ["partner", "job-chat", bookingId] });
    },
  });

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{customerName}</Text>
            <Text style={styles.sub}>
              {bookingNumber}
              {phoneMasked ? ` · ${phoneMasked}` : ""}
            </Text>
          </View>
          <Pressable onPress={onClose} style={styles.closeBtn}>
            <Text style={styles.closeText}>Close</Text>
          </Pressable>
        </View>

        {chat.isLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={partnerColors.primary} />
          </View>
        ) : (
          <FlatList
            data={chat.data?.messages ?? []}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            ListEmptyComponent={
              <Text style={styles.empty}>No messages yet — say hello to the customer.</Text>
            }
            renderItem={({ item }) => (
              <View style={styles.bubble}>
                <Text style={styles.bubbleText}>{item.body}</Text>
              </View>
            )}
          />
        )}

        <View style={styles.composer}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Type a message…"
            style={styles.input}
            maxLength={2000}
          />
          <Pressable
            disabled={!draft.trim() || send.isPending}
            onPress={() => send.mutate(draft.trim())}
            style={[styles.sendBtn, (!draft.trim() || send.isPending) && styles.disabled]}
          >
            {send.isPending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.sendText}>Send</Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: partnerColors.cream },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: partnerColors.line,
    backgroundColor: partnerColors.surface,
  },
  title: { fontSize: 16, fontWeight: "700", color: partnerColors.text },
  sub: { fontSize: 12, color: partnerColors.textMuted, marginTop: 2 },
  closeBtn: { paddingVertical: 8, paddingHorizontal: 10 },
  closeText: { fontWeight: "700", color: partnerColors.primary },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  list: { padding: 16, gap: 8 },
  empty: { textAlign: "center", color: partnerColors.textMuted, marginTop: 40 },
  bubble: {
    alignSelf: "flex-start",
    backgroundColor: partnerColors.surface,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: partnerColors.line,
    maxWidth: "85%",
  },
  bubbleText: { color: partnerColors.text, fontSize: 14 },
  composer: {
    flexDirection: "row",
    gap: 8,
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: partnerColors.line,
    backgroundColor: partnerColors.surface,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: partnerColors.line,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: partnerColors.text,
  },
  sendBtn: {
    backgroundColor: partnerColors.primary,
    borderRadius: 12,
    paddingHorizontal: 16,
    justifyContent: "center",
  },
  sendText: { color: "#fff", fontWeight: "700" },
  disabled: { opacity: 0.5 },
});
