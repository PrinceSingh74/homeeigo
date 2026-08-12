import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { ArrowLeft, Star } from "lucide-react-native";
import { useTheme } from "@/hooks/useTheme";
import {
  useRatingByBookingQuery,
  useSubmitRatingMutation,
} from "@/hooks/use-core-data";
import { coreApi } from "@/services/core/api";
import { useAppStore } from "@/lib/store";
import { getErrorMessage } from "@/lib/auth/errors";
import { spacing, type, radius, screenPadding } from "@/lib/typography";

const RATING_LABEL: Record<number, string> = {
  1: "Poor",
  2: "Fair",
  3: "Good",
  4: "Great",
  5: "Excellent",
};

export default function RateBookingScreen() {
  const router = useRouter();
  const { colors: c } = useTheme();
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const showToast = useAppStore((s) => s.showToast);

  // Existing rating (if the user already reviewed) → enables edit mode.
  const existingQuery = useRatingByBookingQuery(bookingId);
  const existing = existingQuery.data;
  const submit = useSubmitRatingMutation();

  const [stars, setStars] = useState(0);
  const [review, setReview] = useState("");
  const [editing, setEditing] = useState(false);

  // Prefill once the existing rating loads.
  useEffect(() => {
    if (existing) {
      setStars(existing.rating);
      setReview(existing.reviewText ?? "");
    }
  }, [existing]);

  const isEdit = !!existing && !editing;
  const busy = submit.isPending;

  async function handleSubmit() {
    if (!bookingId || stars < 1) {
      showToast("Please select a star rating");
      return;
    }
    try {
      if (existing) {
        // Update path (PUT /api/ratings/:id)
        await coreApi.ratings.update(existing.id, {
          rating: stars,
          reviewText: review.trim() || undefined,
        });
        showToast("Review updated");
      } else {
        // Create path (POST /api/ratings) via the shared mutation
        await submit.mutateAsync({
          bookingId,
          rating: stars,
          reviewText: review.trim() || undefined,
        });
      }
      router.back();
    } catch (error) {
      showToast(getErrorMessage(error));
    }
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: c.bg }]} edges={["top", "left", "right"]}>
      <View style={[styles.header, { borderBottomColor: c.border }]}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          style={[styles.backBtn, { backgroundColor: c.cardBg, borderColor: c.border }]}
          accessibilityLabel="Go back"
        >
          <ArrowLeft size={20} color={c.text} strokeWidth={2.2} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: c.text }]}>
          {existing ? "Your review" : "Rate your service"}
        </Text>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
          {existingQuery.isLoading ? (
            <ActivityIndicator color={c.primary} style={{ marginTop: spacing["3xl"] }} />
          ) : (
            <>
              <Text style={[styles.prompt, { color: c.text }]}>
                {isEdit ? "How you rated this service" : "How was your experience?"}
              </Text>

              {/* Star picker */}
              <View style={styles.stars}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <Pressable
                    key={n}
                    onPress={() => {
                      if (isEdit) setEditing(true);
                      setStars(n);
                    }}
                    hitSlop={8}
                    accessibilityLabel={`${n} star${n > 1 ? "s" : ""}`}
                  >
                    <Star
                      size={44}
                      color={c.gold}
                      fill={n <= stars ? c.gold : "transparent"}
                      strokeWidth={1.6}
                    />
                  </Pressable>
                ))}
              </View>
              {stars > 0 ? (
                <Text style={[styles.ratingLabel, { color: c.primary }]}>{RATING_LABEL[stars]}</Text>
              ) : null}

              {/* Review text */}
              <Text style={[styles.label, { color: c.textSecondary }]}>
                Write a review (optional)
              </Text>
              <TextInput
                value={review}
                onChangeText={(t) => {
                  if (isEdit) setEditing(true);
                  setReview(t);
                }}
                placeholder="Tell others about the quality, punctuality, and professionalism…"
                placeholderTextColor={c.textSecondary}
                multiline
                maxLength={500}
                style={[
                  styles.textArea,
                  { color: c.text, backgroundColor: c.cardBg, borderColor: c.border },
                ]}
              />
              <Text style={[styles.counter, { color: c.textSecondary }]}>{review.length}/500</Text>

              {existing?.providerResponse ? (
                <View style={[styles.responseBox, { backgroundColor: `${c.primary}0D` }]}>
                  <Text style={[styles.responseLabel, { color: c.primary }]}>Provider replied</Text>
                  <Text style={[styles.responseText, { color: c.textSecondary }]}>
                    {existing.providerResponse}
                  </Text>
                </View>
              ) : null}
            </>
          )}
        </ScrollView>

        <View style={[styles.footer, { borderTopColor: c.border, backgroundColor: c.bg }]}>
          <Pressable
            onPress={handleSubmit}
            disabled={busy || stars < 1 || isEdit}
            style={[
              styles.submitBtn,
              { backgroundColor: c.primary, opacity: busy || stars < 1 || isEdit ? 0.5 : 1 },
            ]}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.submitText}>
                {existing ? (isEdit ? "Tap a star to edit" : "Update review") : "Submit review"}
              </Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: screenPadding,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.lg,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { ...type.bodyBold, fontSize: 16 },
  body: { padding: screenPadding, paddingBottom: spacing["3xl"] },
  prompt: { ...type.title, fontSize: 20, textAlign: "center", marginTop: spacing.lg },
  stars: {
    flexDirection: "row",
    justifyContent: "center",
    gap: spacing.sm,
    marginTop: spacing["2xl"],
  },
  ratingLabel: { ...type.bodyBold, fontSize: 15, textAlign: "center", marginTop: spacing.md },
  label: { ...type.overline, fontSize: 10, marginTop: spacing["2xl"], marginBottom: spacing.sm },
  textArea: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
    minHeight: 120,
    textAlignVertical: "top",
    ...type.body,
  },
  counter: { ...type.caption, textAlign: "right", marginTop: 4 },
  responseBox: { borderRadius: radius.lg, padding: spacing.md, marginTop: spacing.lg, gap: 4 },
  responseLabel: { ...type.caption, fontWeight: "700" },
  responseText: { ...type.body, lineHeight: 21 },
  footer: {
    paddingHorizontal: screenPadding,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  submitBtn: {
    height: 52,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  submitText: { ...type.bodyBold, color: "#fff", fontSize: 16 },
});
