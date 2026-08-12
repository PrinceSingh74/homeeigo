import React, { useState } from "react";
import { View, Text, TextInput, Pressable, FlatList, ActivityIndicator } from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { useTheme } from "@/hooks/useTheme";
import { parityApi, type SupportTicket } from "@/services/core/parity-api";

const CATEGORIES = ["Booking", "Payment", "Account", "Other"];

/** Support tickets — list + create, backed by /api/support/tickets (same API the web uses). */
export default function SupportTicketsScreen() {
  const { colors: c } = useTheme();
  const qc = useQueryClient();
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [category, setCategory] = useState(CATEGORIES[0]);

  const ticketsQ = useQuery({ queryKey: ["support-tickets"], queryFn: () => parityApi.support.list() });
  const createM = useMutation({
    mutationFn: () => parityApi.support.create(subject.trim(), message.trim(), category),
    onSuccess: () => {
      setSubject("");
      setMessage("");
      void qc.invalidateQueries({ queryKey: ["support-tickets"] });
    },
  });

  // Backend requires subject ≥ 3 and description ≥ 10 chars.
  const canSubmit = subject.trim().length >= 3 && message.trim().length >= 10 && !createM.isPending;

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <ScreenHeader title="Support" />
      <FlatList
        data={ticketsQ.data ?? []}
        keyExtractor={(t) => t.id}
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}
        ListHeaderComponent={
          <View style={{ backgroundColor: c.cardBg, borderRadius: 16, borderWidth: 1, borderColor: c.border, padding: 16, marginBottom: 8 }}>
            <Text style={{ fontSize: 16, fontWeight: "700", color: c.text, marginBottom: 12 }}>New ticket</Text>
            <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
              {CATEGORIES.map((cat) => (
                <Pressable
                  key={cat}
                  onPress={() => setCategory(cat)}
                  style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: category === cat ? c.primary : "transparent", borderWidth: 1, borderColor: category === cat ? c.primary : c.border }}
                >
                  <Text style={{ color: category === cat ? "white" : c.textSecondary, fontSize: 12, fontWeight: "600" }}>{cat}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              value={subject}
              onChangeText={setSubject}
              placeholder="Subject"
              placeholderTextColor={c.textSecondary}
              style={{ borderWidth: 1, borderColor: c.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: c.text, marginBottom: 10 }}
            />
            <TextInput
              value={message}
              onChangeText={setMessage}
              placeholder="Describe your issue (at least 10 characters)"
              placeholderTextColor={c.textSecondary}
              multiline
              style={{ borderWidth: 1, borderColor: c.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: c.text, minHeight: 80, textAlignVertical: "top", marginBottom: 12 }}
            />
            {createM.isError && <Text style={{ color: "#DC2626", marginBottom: 8 }}>Could not create ticket. Try again.</Text>}
            <Pressable
              disabled={!canSubmit}
              onPress={() => createM.mutate()}
              style={{ backgroundColor: canSubmit ? c.primary : c.border, borderRadius: 12, paddingVertical: 12, alignItems: "center" }}
            >
              {createM.isPending ? <ActivityIndicator color="white" /> : <Text style={{ color: "white", fontWeight: "700" }}>Submit ticket</Text>}
            </Pressable>
          </View>
        }
        renderItem={({ item }: { item: SupportTicket }) => (
          <View style={{ backgroundColor: c.cardBg, borderRadius: 14, borderWidth: 1, borderColor: c.border, padding: 14 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ fontWeight: "700", color: c.text, flex: 1 }} numberOfLines={1}>{item.subject}</Text>
              <Text style={{ fontSize: 11, fontWeight: "700", color: c.primary }}>{item.status}</Text>
            </View>
            <Text style={{ color: c.textSecondary, fontSize: 12, marginTop: 4 }}>{item.category} · {new Date(item.createdAt).toLocaleDateString()}</Text>
          </View>
        )}
        ListEmptyComponent={
          ticketsQ.isLoading ? (
            <ActivityIndicator style={{ marginTop: 24 }} color={c.primary} />
          ) : ticketsQ.isError ? (
            <Text style={{ textAlign: "center", color: "#DC2626", marginTop: 24 }}>Couldn't load tickets.</Text>
          ) : (
            <Text style={{ textAlign: "center", color: c.textSecondary, marginTop: 24 }}>No support tickets yet.</Text>
          )
        }
      />
    </View>
  );
}
