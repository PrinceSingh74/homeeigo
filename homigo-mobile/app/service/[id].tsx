// Service detail — what the customer is promised before they book: what the service is, what to
// have ready, and the visit promise (process, safety, photos, cover, who can book). Every sentence
// below a heading comes from GET /api/services/:id; a block the server did not send is not drawn.
import React, { useEffect } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams } from "expo-router";
import { useTheme } from "@/hooks/useTheme";
import { useServiceDetailQuery, useServiceReviewsQuery } from "@/hooks/use-core-data";
import { useAppNavigation } from "@/hooks/useAppNavigation";
import { trackFunnelEvent } from "@/lib/analytics/funnel";
import { Button } from "@/components/Button";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { radius, screenPadding, spacing, type } from "@/lib/typography";
import type { BackendServiceDetail, CustomerRequirement, CustomerRequirementsView } from "@/types/backend";

type Colors = ReturnType<typeof useTheme>["colors"];

/** Same grouping and titles as web ServicePreparation; an empty group is not rendered. */
const PREPARATION_GROUPS: { key: keyof Omit<CustomerRequirementsView, "empty">; title: string; hint?: string }[] = [
  { key: "beforeBooking", title: "Please confirm before booking", hint: "You'll confirm these on the booking page." },
  { key: "beforeArrival", title: "Have this ready at your home" },
  { key: "youProvide", title: "You'll provide" },
  { key: "shared", title: "Shared between you and your professional" },
  { key: "weBring", title: "We'll bring" },
  { key: "optional", title: "Optional", hint: "Not needed for the service to go ahead." },
];

/** The server's own estimate; a range only when it sent both ends. null = it sent no duration. */
function durationLabel(s: BackendServiceDetail): string | null {
  const e = s.duration?.customerEstimate;
  if (e) {
    if (e.minMinutes != null && e.maxMinutes != null && e.minMinutes !== e.maxMinutes) return `${e.minMinutes}–${e.maxMinutes} min`;
    if (e.estimatedMinutes > 0) return `About ${e.estimatedMinutes} min`;
  }
  return typeof s.estimatedDuration === "number" && s.estimatedDuration > 0 ? `About ${s.estimatedDuration} min` : null;
}

export default function ServiceDetailScreen() {
  const { colors: c } = useTheme();
  const params = useLocalSearchParams<{ id?: string }>();
  const id = params.id ? String(params.id) : null;
  const query = useServiceDetailQuery(id);
  const { book } = useAppNavigation();
  const service = query.data?.service;
  const reviewList = useServiceReviewsQuery(service?.id ?? null).data;

  // Phase 15.2 — service_view once the server's own detail is on screen; keyed on (service,
  // version) so a re-render or a return to this screen in the same launch stays one row.
  const viewedId = service?.id;
  const viewedVersion = service?.version;
  useEffect(() => {
    if (!viewedId) return;
    trackFunnelEvent("SERVICE_VIEW", { serviceId: viewedId, serviceVersionId: viewedVersion, metadata: { page: "service-detail" } });
  }, [viewedId, viewedVersion]);

  if (!service) {
    return (
      <View style={[styles.root, { backgroundColor: c.bg }]}>
        <ScreenHeader title="Service" />
        <View style={styles.center} accessibilityLiveRegion="polite">
          {query.isLoading ? (
            <>
              <ActivityIndicator size="large" color={c.primary} />
              <Text style={[styles.centerText, { color: c.textSecondary }]}>Loading service…</Text>
            </>
          ) : (
            <>
              <Text style={[styles.centerTitle, { color: c.text }]}>
                {query.isError ? "We couldn't load this service" : "This service isn't available"}
              </Text>
              <Text style={[styles.centerText, { color: c.textSecondary }]}>
                {query.isError ? "Check your connection and try again." : "It may have been removed. Please pick another service."}
              </Text>
              {query.isError ? (
                <Button title="Try again" variant="secondary" onPress={() => void query.refetch()} loading={query.isRefetching} />
              ) : null}
            </>
          )}
        </View>
      </View>
    );
  }

  const content = service.content;
  const summary = content?.summary?.trim() || service.description?.trim() || null;
  const detailed = service.detailedDescription?.trim() || null;
  const duration = durationLabel(service);
  const faqs = (service.catalogConfig?.faqs ?? []).filter((f) => f.q?.trim() && f.a?.trim());
  const reviews = service.reviewCount ?? 0;
  // Only a real review aggregate is shown — never a placeholder score.
  const rating = service.rating != null && service.rating > 0 && reviews > 0 ? service.rating.toFixed(1) : null;
  const preparation = service.preparation && !service.preparation.empty ? service.preparation : null;
  const visit = service.visit ?? null;
  // The server decides; an older response without the flag falls back to the catalogue's coming-soon mark.
  const comingSoon = service.comingSoon === true || service.catalogConfig?.comingSoon === true;
  const bookable = !comingSoon && service.bookable !== false;

  return (
    <View style={[styles.root, { backgroundColor: c.bg }]}>
      <ScreenHeader title="Service details" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} testID="service-detail">
        <Text style={[styles.name, { color: c.text }]} accessibilityRole="header">
          {service.name}
        </Text>
        {content?.valueProposition ? <Text style={[styles.lead, { color: c.text }]}>{content.valueProposition}</Text> : null}

        <View style={styles.facts}>
          {duration ? <Fact label="Duration" value={duration} c={c} /> : null}
          {rating ? <Fact label="Rating" value={`${rating} · ${reviews} ${reviews === 1 ? "review" : "reviews"}`} c={c} /> : null}
        </View>

        {comingSoon ? (
          <Text style={[styles.banner, { color: c.text, borderColor: c.border, backgroundColor: c.cardBg }]} testID="service-coming-soon">
            Coming soon — this service can't be booked yet.
          </Text>
        ) : null}

        {summary || detailed ? (
          <Section title="About this service" c={c}>
            {summary ? <Text style={[styles.body, { color: c.text }]}>{summary}</Text> : null}
            {detailed && detailed !== summary ? <Text style={[styles.body, { color: c.textSecondary }]}>{detailed}</Text> : null}
          </Section>
        ) : null}

        {content ? (
          <>
            <ListSection title="Highlights" items={content.highlights} c={c} />
            <ListSection title="Benefits" items={content.keyBenefits} c={c} />
            <ListSection title="What's included" items={content.included} glyph="✓" c={c} />
            <ListSection title="What's not included" items={content.excluded} glyph="–" c={c} />
            <ListSection title="Good to know" items={[...content.limitations, ...content.importantNotes, ...content.customerDisclosures]} c={c} />
          </>
        ) : null}

        {preparation ? (
          <Section title="What you need before we arrive" c={c} testID="service-preparation">
            {PREPARATION_GROUPS.map((g) => {
              const items = preparation[g.key];
              if (!items.length) return null;
              return (
                <View key={g.key} style={styles.group}>
                  <Text style={[styles.groupTitle, { color: c.text }]}>{g.title}</Text>
                  {g.hint ? <Text style={[styles.small, { color: c.textSecondary }]}>{g.hint}</Text> : null}
                  {items.map((item) => (
                    <Requirement key={item.code} item={item} c={c} />
                  ))}
                </View>
              );
            })}
          </Section>
        ) : null}

        {visit ? <VisitPromise visit={visit} c={c} /> : null}

        {reviewList && reviewList.ratingCount > 0 && reviewList.averageRating != null ? (
          <Section title="Customer reviews" c={c} testID="service-reviews">
            <Text style={[styles.groupTitle, { color: c.text }]}>
              {reviewList.averageRating.toFixed(1)} out of 5 · {reviewList.ratingCount} {reviewList.ratingCount === 1 ? "rating" : "ratings"}
            </Text>
            {reviewList.reviews.map((r) => (
              <View key={r.id} style={styles.group} accessible accessibilityLabel={`${r.name}, ${r.rating} out of 5 stars. ${r.reviewText ?? ""}`}>
                <Text style={[styles.groupTitle, { color: c.text }]}>
                  {r.name} · {r.rating}/5
                </Text>
                {r.reviewText ? <Text style={[styles.body, { color: c.textSecondary }]}>{r.reviewText}</Text> : null}
                {r.providerResponse ? (
                  <Text style={[styles.small, { color: c.textSecondary }]}>Response from the professional: {r.providerResponse}</Text>
                ) : null}
              </View>
            ))}
          </Section>
        ) : null}

        {faqs.length > 0 ? (
          <Section title="Questions" c={c} testID="service-faqs">
            {faqs.map((f) => (
              <View key={f.q} style={styles.group}>
                <Text style={[styles.groupTitle, { color: c.text }]}>{f.q}</Text>
                <Text style={[styles.body, { color: c.textSecondary }]}>{f.a}</Text>
              </View>
            ))}
          </Section>
        ) : null}
      </ScrollView>

      <SafeAreaView edges={["bottom"]} style={[styles.bar, { backgroundColor: c.cardBg, borderTopColor: c.border }]}>
        <View style={styles.barInner}>
          {duration ? (
            <View style={styles.barPrice}>
              <Text style={[styles.small, { color: c.textSecondary }]}>{duration}</Text>
            </View>
          ) : null}
          <View style={styles.barAction}>
            {bookable ? (
              <Button
                title="Book"
                size="lg"
                onPress={() => {
                  // The tap is the booking start; the book screen fires the same id again and the server keeps one row.
                  trackFunnelEvent("BOOKING_STARTED", { serviceId: service.id, metadata: { entry: "service-detail-cta" } });
                  book({ service: service.id });
                }}
                accessibilityLabel={`Book ${service.name}`}
              />
            ) : (
              <View
                style={[styles.unavailable, { borderColor: c.border, backgroundColor: c.bg }]}
                accessible
                accessibilityRole="text"
                testID="service-not-bookable"
              >
                <Text style={[styles.unavailableText, { color: c.textSecondary }]}>
                  {comingSoon ? "Coming soon" : "Not available to book right now"}
                </Text>
              </View>
            )}
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

/** The backend visit promise (mirror of web ServiceVisit). Headings label a block; they are never a claim. */
function VisitPromise({ visit, c }: { visit: NonNullable<BackendServiceDetail["visit"]>; c: Colors }) {
  const safety = visit.safety;
  const chemicalRestrictions = safety?.chemicalRestrictions ?? [];
  const safetyHasContent =
    !!safety &&
    (!!safety.information ||
      safety.customerRequirements.length > 0 ||
      safety.warnings.length > 0 ||
      chemicalRestrictions.length > 0 ||
      !!safety.medicalDisclaimer ||
      !!safety.emergencyProtocol);
  const warranty = visit.warranty;
  const guarantee = warranty?.guarantee?.trim() || null;
  const damagePolicy = warranty?.damagePolicy?.trim() || null;
  const warrantyHasContent = !!warranty && (warranty.statements.length > 0 || warranty.exclusions.length > 0 || !!guarantee || !!damagePolicy);

  return (
    <>
      {visit.process.length > 0 ? (
        <Section title="On the visit" c={c} testID="service-visit-process">
          {visit.process.map((step, i) => (
            <View key={step.code} style={styles.step} accessible accessibilityLabel={`Step ${i + 1}. ${step.title}. ${step.detail}`}>
              <Text style={[styles.stepNumber, { color: c.primary }]}>{String(i + 1).padStart(2, "0")}</Text>
              <View style={styles.stepBody}>
                <Text style={[styles.groupTitle, { color: c.text }]}>{step.title}</Text>
                <Text style={[styles.body, { color: c.textSecondary }]}>{step.detail}</Text>
              </View>
            </View>
          ))}
        </Section>
      ) : null}

      {safety && safetyHasContent ? (
        <Section title="Safety" c={c} testID="service-visit-safety">
          {safety.information ? <Text style={[styles.body, { color: c.text }]}>{safety.information}</Text> : null}
          {safety.customerRequirements.map((item) => (
            <Bullet key={item} text={item} color={c.text} />
          ))}
          {safety.warnings.map((item) => (
            <Bullet key={item} text={item} glyph="⚠" color={c.text} />
          ))}
          {chemicalRestrictions.length > 0 ? (
            <View style={styles.group} testID="service-chemical-restrictions">
              <Text style={[styles.groupTitle, { color: c.text }]}>Products we don't use, or use with care</Text>
              {chemicalRestrictions.map((item) => (
                <Bullet key={item} text={item} color={c.textSecondary} />
              ))}
            </View>
          ) : null}
          {safety.medicalDisclaimer ? <Text style={[styles.small, { color: c.textSecondary }]}>{safety.medicalDisclaimer}</Text> : null}
          {safety.emergencyProtocol ? (
            <Text style={[styles.small, { color: c.textSecondary }]}>In an emergency: {safety.emergencyProtocol}</Text>
          ) : null}
        </Section>
      ) : null}

      {visit.proof && visit.proof.statements.length > 0 ? (
        <Section title="Photos of the work" c={c} testID="service-visit-proof">
          {visit.proof.statements.map((line) => (
            <Text key={line} style={[styles.body, { color: c.text }]}>{line}</Text>
          ))}
        </Section>
      ) : null}

      {warranty && warrantyHasContent ? (
        <Section title="Cover and complaints" c={c} testID="service-visit-warranty">
          {guarantee ? (
            <View style={[styles.promise, { borderLeftColor: c.primary, backgroundColor: c.primary + "12" }]} testID="service-guarantee">
              <Text style={[styles.overline, { color: c.primary }]}>Our promise</Text>
              <Text style={[styles.promiseText, { color: c.text }]}>{guarantee}</Text>
            </View>
          ) : null}
          {warranty.statements.map((line) => (
            <Text key={line} style={[styles.body, { color: c.text }]}>{line}</Text>
          ))}
          {damagePolicy ? (
            <View style={styles.group} testID="service-damage-policy">
              <Text style={[styles.groupTitle, { color: c.text }]}>If something is damaged</Text>
              <Text style={[styles.body, { color: c.textSecondary }]}>{damagePolicy}</Text>
            </View>
          ) : null}
          {warranty.exclusions.length > 0 ? (
            <View style={styles.group}>
              <Text style={[styles.groupTitle, { color: c.text }]}>Not covered</Text>
              {warranty.exclusions.map((line) => (
                <Bullet key={line} text={line} glyph="–" color={c.textSecondary} />
              ))}
            </View>
          ) : null}
        </Section>
      ) : null}

      {visit.age ? (
        <Section title="Who can book" c={c} testID="service-visit-age">
          <Text style={[styles.body, { color: c.text }]}>{visit.age.statement}</Text>
        </Section>
      ) : null}
    </>
  );
}

function Section({ title, children, c, testID }: { title: string; children: React.ReactNode; c: Colors; testID?: string }) {
  return (
    <View style={styles.section} testID={testID}>
      <Text style={[styles.sectionTitle, { color: c.text }]} accessibilityRole="header">
        {title}
      </Text>
      <View style={[styles.card, { backgroundColor: c.cardBg, borderColor: c.border }]}>{children}</View>
    </View>
  );
}

function ListSection({ title, items, glyph, c }: { title: string; items: string[]; glyph?: string; c: Colors }) {
  if (!items.length) return null;
  return (
    <Section title={title} c={c}>
      {items.map((item) => (
        <Bullet key={item} text={item} glyph={glyph} color={c.text} />
      ))}
    </Section>
  );
}

function Bullet({ text, glyph = "•", color }: { text: string; glyph?: string; color: string }) {
  return (
    <View style={styles.bullet}>
      <Text style={[styles.body, styles.bulletGlyph, { color }]}>{glyph}</Text>
      <Text style={[styles.body, styles.bulletText, { color }]}>{text}</Text>
    </View>
  );
}

function Fact({ label, value, c }: { label: string; value: string; c: Colors }) {
  return (
    <View style={[styles.fact, { backgroundColor: c.cardBg, borderColor: c.border }]} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={[styles.overline, { color: c.textSecondary }]}>{label}</Text>
      <Text style={[styles.factValue, { color: c.text }]}>{value}</Text>
    </View>
  );
}

function Requirement({ item, c }: { item: CustomerRequirement; c: Colors }) {
  const meta = [item.quantity, item.chargeText, item.timingText].filter(Boolean).join(" · ");
  return (
    <View style={styles.requirement}>
      <Text style={[styles.body, { color: c.text }]}>• {item.label}</Text>
      {meta ? <Text style={[styles.small, styles.requirementMeta, { color: c.textSecondary }]}>{meta}</Text> : null}
      {item.note ? <Text style={[styles.small, styles.requirementMeta, { color: c.textSecondary }]}>{item.note}</Text> : null}
      {item.procurementText ? <Text style={[styles.small, styles.requirementMeta, { color: c.textSecondary }]}>{item.procurementText}</Text> : null}
      {item.warning ? <Text style={[styles.small, styles.requirementMeta, { color: c.text }]}>⚠ {item.warning}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: screenPadding, gap: spacing.md },
  centerTitle: { ...type.title, textAlign: "center" },
  centerText: { ...type.body, textAlign: "center" },
  scroll: { paddingHorizontal: screenPadding, paddingTop: spacing.sm, paddingBottom: spacing["3xl"] },
  name: { ...type.headline },
  lead: { ...type.body, marginTop: spacing.sm },
  facts: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.lg },
  fact: { borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: 2 },
  factValue: { ...type.bodyBold },
  overline: { ...type.overline },
  banner: { ...type.small, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, marginTop: spacing.lg, overflow: "hidden" },
  section: { marginTop: spacing["2xl"] },
  sectionTitle: { ...type.section, marginBottom: spacing.md },
  card: { borderWidth: 1, borderRadius: radius.md, padding: spacing.lg, gap: spacing.sm },
  body: { ...type.body },
  small: { ...type.small },
  group: { gap: spacing.xs, marginTop: spacing.xs },
  groupTitle: { ...type.bodyBold },
  bullet: { flexDirection: "row", gap: spacing.sm },
  bulletGlyph: { width: 16 },
  bulletText: { flex: 1 },
  step: { flexDirection: "row", gap: spacing.md, paddingVertical: spacing.xs },
  stepNumber: { ...type.bodyBold, width: 24 },
  stepBody: { flex: 1, gap: 2 },
  promise: { borderLeftWidth: 4, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.md, gap: spacing.xs },
  promiseText: { ...type.bodyBold },
  requirement: { paddingVertical: 2 },
  requirementMeta: { marginLeft: spacing.md },
  bar: { borderTopWidth: StyleSheet.hairlineWidth },
  barInner: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: screenPadding, paddingVertical: spacing.md },
  barPrice: { gap: 2 },
  barPriceValue: { ...type.price },
  barAction: { flex: 1 },
  unavailable: { minHeight: 48, borderWidth: 1, borderRadius: radius.md, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.lg },
  unavailableText: { ...type.bodyBold },
});
