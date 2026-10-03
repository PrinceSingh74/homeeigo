import React, { useEffect, useState } from "react";
import {
  View,
  FlatList,
  StyleSheet,
  Text,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { MessageCircle, Trash2 } from "lucide-react-native";
import { coreApi } from "@/services/core/api";
import { useAuthStore } from "@/stores/auth-store";
import { useAiTheme, aiSpacing, aiType, aiRadius } from "@/lib/ai-mobile-theme";
import { PressableScale } from "./PressableScale";

type Conversation = {
  id: string;
  title: string | null;
  messageCount: number;
  /** When the conversation was last active, or null when the server gave no usable time. */
  updatedAt: string | null;
};

type LatestConversation = NonNullable<Awaited<ReturnType<typeof coreApi.ai.latestConversation>>>;

/**
 * The conversation's real last-activity time. Prefers the conversation's own `updatedAt`, and
 * otherwise the newest message's `createdAt`. Returns null rather than inventing a time: stamping
 * the row with the moment it was loaded made every conversation read "just now".
 */
function lastActivityAt(data: LatestConversation): string | null {
  const own = toIso(data.updatedAt);
  if (own) return own;
  let newest: string | null = null;
  for (const message of data.messages) {
    const at = toIso(message.createdAt);
    // Normalised ISO strings order the same way the instants do.
    if (at && (newest === null || at > newest)) newest = at;
  }
  return newest;
}

function toIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

export function AiConversationsList({
  onSelectConversation,
  onDelete,
}: {
  onSelectConversation: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { c, isDark } = useAiTheme();
  // The list belongs to the signed-in account, so it is keyed on that account's id.
  const userId = useAuthStore((s) => s.user?.id ?? null);

  useEffect(() => {
    // `active` goes false when the account changes or the list unmounts, so a response that was
    // requested for the previous account can never be written into the next account's list.
    let active = true;

    // Drop the previous account's rows before asking for the new account's: they must not stay
    // on screen while the request is in flight, or if it fails.
    setConversations([]);
    setError(null);

    // Signed out: there is no account to load for, and the endpoint requires one.
    if (!userId) {
      setLoading(false);
      return;
    }

    setLoading(true);

    void (async () => {
      try {
        const data = await coreApi.ai.latestConversation();
        if (!active) return;
        setConversations(
          data
            ? [
                {
                  id: data.id,
                  title: data.title || "Untitled",
                  messageCount: data.messages.length,
                  updatedAt: lastActivityAt(data),
                },
              ]
            : [],
        );
      } catch (err) {
        if (!active) return;
        setError("Failed to load conversations");
        console.error(err);
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [userId]);

  const handleDelete = (id: string) => {
    Alert.alert(
      "Delete conversation",
      "This action cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await coreApi.ai.deleteConversation(id);
              setConversations((prev) => prev.filter((c) => c.id !== id));
              onDelete(id);
            } catch (err) {
              Alert.alert("Error", "Failed to delete conversation");
            }
          },
        },
      ],
    );
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString("en-IN");
  };

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: c.bg }]}>
        <ActivityIndicator size="large" color={c.accent} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.container, { backgroundColor: c.bg }]}>
        <Text style={[styles.error, { color: c.text }]}>{error}</Text>
      </View>
    );
  }

  if (conversations.length === 0) {
    return (
      <View style={[styles.container, { backgroundColor: c.bg }]}>
        <View style={styles.empty}>
          <MessageCircle size={48} color={c.muted} strokeWidth={1.5} />
          <Text style={[styles.emptyText, { color: c.text }]}>No conversations yet</Text>
          <Text style={[styles.emptySubtext, { color: c.muted }]}>
            Start chatting to see your history here
          </Text>
        </View>
      </View>
    );
  }

  return (
    <LinearGradient
      colors={isDark ? ["#030814", "#0b0f1f"] : ["#f0fdf4", "#f8fafc"]}
      style={styles.container}
    >
      <FlatList
        data={conversations}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <PressableScale
            onPress={() => onSelectConversation(item.id)}
            style={[styles.conversationItem, { backgroundColor: c.card, borderColor: c.cardBorder }]}
            haptic
          >
            <View style={styles.conversationContent}>
              <Text style={[styles.conversationTitle, { color: c.text }]} numberOfLines={1}>
                {item.title}
              </Text>
              <Text style={[styles.conversationMeta, { color: c.muted }]}>
                {item.messageCount} messages
                {item.updatedAt ? ` • ${formatDate(item.updatedAt)}` : ""}
              </Text>
            </View>
            <PressableScale
              onPress={() => handleDelete(item.id)}
              style={styles.deleteBtn}
              haptic
              accessibilityRole="button"
              accessibilityLabel="Delete conversation"
            >
              <Trash2 size={18} color={c.muted} strokeWidth={2} />
            </PressableScale>
          </PressableScale>
        )}
        contentContainerStyle={styles.listContainer}
        scrollEnabled={conversations.length > 3}
      />
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listContainer: {
    paddingHorizontal: aiSpacing.screen,
    paddingVertical: aiSpacing.screen,
    gap: aiSpacing.gap,
  },
  conversationItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: aiSpacing.gap,
    borderRadius: aiRadius.lg,
    borderWidth: 1,
  },
  conversationContent: {
    flex: 1,
    minWidth: 0,
  },
  conversationTitle: {
    ...aiType.body,
    fontWeight: "600",
    marginBottom: 4,
  },
  conversationMeta: {
    ...aiType.caption,
    fontSize: 12,
  },
  deleteBtn: {
    marginLeft: aiSpacing.gap,
    padding: 8,
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: aiSpacing.gap,
  },
  emptyText: {
    ...aiType.body,
    fontWeight: "600",
    fontSize: 16,
  },
  emptySubtext: {
    ...aiType.caption,
    fontSize: 13,
    maxWidth: 280,
    textAlign: "center",
  },
  error: {
    ...aiType.body,
    textAlign: "center",
    marginTop: 32,
  },
});
