import { useMutation } from "@tanstack/react-query";
import { MapPinned, Sparkles } from "lucide-react-native";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { failureSentence } from "@/components/money/DataScreen";
import { Banner, Button, Card, EmptyState, Field, ListRow, Pill, T } from "@/components/ui";
import { confidencePercent, updatedAgo } from "@/lib/money-format";
import { pageOf } from "@/lib/money-series";
import { serverNow } from "@/lib/server-clock";
import { partnerApi } from "@/services/partner-api";
import { color, radius, space } from "@/theme/tokens";
import type { DensityZone, SurgeZone } from "@/types/partner";

/**
 * How fresh and how sure a geo-intelligence reading is, in the server's own terms: the instant it
 * stamped on the reading and its 0–1 confidence as a percentage. Nothing is graded on the phone —
 * there is no client threshold that turns a number into "good" or "low".
 */
export function IntelMeta({ freshness, generatedAt, confidence }: { freshness?: string | null; generatedAt?: string | null; confidence?: number | null }) {
  const age = updatedAgo(freshness ?? generatedAt ?? null, serverNow());
  const sure = confidencePercent(confidence);
  if (!age && !sure) return null;
  return (
    <View style={styles.meta} testID="intel-meta">
      {age ? <Pill label={age} /> : null}
      {sure ? <Pill label={`Confidence ${sure}`} /> : <Pill label="Confidence not stated" />}
    </View>
  );
}

const ZONE_PAGE = 8;

/** Surge by zone (`GET /api/geo-intel/surge`), highest first as the server sorts it. */
export function SurgeZoneList({ zones }: { zones: SurgeZone[] }) {
  const [shown, setShown] = useState(ZONE_PAGE);
  const { visible, hidden } = pageOf(zones, shown);
  if (zones.length === 0) {
    return (
      <Card>
        <EmptyState icon={MapPinned} title="No zones to show" message="The server sent no zone readings. Pull down to ask again." testID="surge-empty" />
      </Card>
    );
  }
  return (
    <Card testID="surge-list">
      {visible.map((z, i) => (
        <ListRow
          key={z.zoneId}
          icon={MapPinned}
          title={`${z.name}${z.city ? ` · ${z.city}` : ""}`}
          subtitle={`${z.activeBookings} active ${z.activeBookings === 1 ? "booking" : "bookings"} · ${z.supply} ${z.supply === 1 ? "partner" : "partners"} in zone`}
          value={`${z.predictedSurge.toFixed(2)}×`}
          last={i === visible.length - 1 && hidden === 0}
        />
      ))}
      {hidden > 0 ? <Button label={`Show ${Math.min(ZONE_PAGE, hidden)} more`} variant="quiet" onPress={() => setShown((n) => n + ZONE_PAGE)} /> : null}
    </Card>
  );
}

/** Partners per zone (`GET /api/geo-intel/provider-density`). */
export function DensityZoneList({ zones }: { zones: DensityZone[] }) {
  const [shown, setShown] = useState(ZONE_PAGE);
  const { visible, hidden } = pageOf(zones, shown);
  if (zones.length === 0) {
    return (
      <Card>
        <EmptyState icon={MapPinned} title="No zones to show" message="The server sent no coverage readings. Pull down to ask again." testID="density-empty" />
      </Card>
    );
  }
  return (
    <Card testID="density-list">
      {visible.map((z, i) => (
        <ListRow
          key={z.zoneId}
          icon={MapPinned}
          title={`${z.name}${z.city ? ` · ${z.city}` : ""}`}
          subtitle={`${z.densityPerKm2.toFixed(2)} per km² · ${z.liveSupply} online now`}
          value={`${z.providers}`}
          last={i === visible.length - 1 && hidden === 0}
        />
      ))}
      {hidden > 0 ? <Button label={`Show ${Math.min(ZONE_PAGE, hidden)} more`} variant="quiet" onPress={() => setShown((n) => n + ZONE_PAGE)} /> : null}
    </Card>
  );
}

type Turn = { q: string; a: string | null; error: string | null; summaryOnly: boolean; basis: string[]; recommendation: string | null };

/**
 * The assistant: a question sent to `POST /api/ai/partner` and the answer that came back. There is
 * no list of "insights" above it — nothing on this screen is written by the app. When the gateway
 * answers from its rule-based fallback instead of a model, the turn says so; when the call fails,
 * the turn shows the failure, not a stand-in answer.
 */
export function AssistantChat() {
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const ask = useMutation({
    mutationFn: (q: string) => partnerApi.aiChat(q),
    onSuccess: (res, q) =>
      setTurns((t) => [
        ...t,
        { q, a: res.content, error: null, summaryOnly: res.mode === "deterministic_fallback", basis: Array.isArray(res.basis) ? res.basis : [], recommendation: res.recommendation ?? null },
      ]),
    onError: (e, q) => setTurns((t) => [...t, { q, a: null, error: failureSentence(e), summaryOnly: false, basis: [], recommendation: null }]),
  });

  const send = () => {
    const q = input.trim();
    if (!q || ask.isPending) return;
    setInput("");
    ask.mutate(q);
  };

  return (
    <>
      {turns.length === 0 && !ask.isPending ? (
        <Card>
          <EmptyState icon={Sparkles} title="Ask a question" message="Ask about your jobs, earnings or schedule. Answers come from the HOMEEIGO assistant and can be wrong — check anything about money in your wallet." testID="assistant-empty" />
        </Card>
      ) : null}
      {turns.map((t, i) => (
        <Card key={i} testID={`assistant-turn-${i}`}>
          <T kind="smallStrong" tone="slate">
            You asked
          </T>
          <T kind="body">{t.q}</T>
          <View style={styles.answer}>
            {t.error ? (
              <Banner tone="danger" title="No answer" message={t.error} />
            ) : (
              <>
                <T kind="smallStrong" tone="slate">
                  Assistant
                </T>
                <T kind="body">{t.a ?? ""}</T>
                {t.recommendation ? <T kind="small" tone="ink">{t.recommendation}</T> : null}
                {t.basis.length > 0 ? <T kind="small">{`Based on: ${t.basis.join("; ")}`}</T> : null}
                {t.summaryOnly ? <Pill label="Summary from your data — the AI model did not answer" tone="warning" /> : null}
              </>
            )}
          </View>
        </Card>
      ))}
      {ask.isPending ? (
        <Card>
          <T kind="small" accessibilityRole="progressbar" accessibilityLabel="Waiting for the assistant…">
            Waiting for the assistant…
          </T>
        </Card>
      ) : null}
      <Card testID="assistant-composer">
        <View style={styles.composer}>
          <Field
            label="Your question"
            value={input}
            onChangeText={setInput}
            onSubmitEditing={send}
            placeholder="Ask the assistant…"
            accessibilityLabel="Ask the partner copilot"
            editable={!ask.isPending}
            returnKeyType="send"
            testID="assistant-input"
          />
          <Button label="Ask" accessibilityLabel="Send question" onPress={send} loading={ask.isPending} disabled={!input.trim()} testID="assistant-send" />
        </View>
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  meta: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  answer: { marginTop: space.md, padding: space.md, borderRadius: radius.control, backgroundColor: color.well, gap: space.xs },
  composer: { gap: space.md },
});
