import { StyleSheet, View } from "react-native";
import { Banner, Button, T } from "@/components/ui";
import { useOfferCountdown } from "@/hooks/use-offer-countdown";
import type { LifecycleAction } from "@/hooks/job/use-job-lifecycle";
import type { JobAction } from "@/lib/job-action-policy";
import { formatCountdown, type OfferWindow } from "@/lib/offer";
import { space } from "@/theme/tokens";

type Props = {
  /** The one action for the current stage, from the server's `/actions` answer (the mirror until it arrives). */
  action: JobAction | null;
  /** Its label ("Accept", "On my way", "I've arrived", "Start job", "Complete job"). */
  label: string | null;
  /** True when the server (or a gate the server enforces) says the action cannot be taken now. */
  disabled: boolean;
  /** Why, in the server's words where it wrote them; shown under the button. */
  hint: string | null;
  /** Which request is in flight (including its awaited detail refetch). */
  pendingAction: LifecycleAction | null;
  onPrimary: () => void;
  /** Offers only. */
  isOffer: boolean;
  /** The live window from the offer feed; `null` with `offerKnown` = the feed no longer lists this job. */
  offer: OfferWindow | null;
  offerKnown: boolean;
  onDecline: () => void;
};

/**
 * The docked footer of the job screen: ONE primary action for the current stage, in reach of the
 * thumb, with the reason under it when it cannot be taken. An offer also shows its countdown and a
 * quiet "Decline" that never competes with "Accept". An offer that can no longer be won shows why
 * and no button at all.
 *
 * It asks for nothing and decides nothing: the screen passes the server's answer in. Calling the
 * customer is not here or anywhere on the job screen — the server has no call relay for a partner
 * (see `lib/customer-call.ts`); the brief shows the masked number and points to chat.
 */
export function JobLifecycleActions({ action, label, disabled, hint, pendingAction, onPrimary, isOffer, offer, offerKnown, onDecline }: Props) {
  const countdown = useOfferCountdown(isOffer ? offer : null);
  // Past its deadline (server-time estimate), or absent from a complete offer feed.
  const offerClosed = isOffer && ((countdown?.expired ?? false) || (offerKnown && !offer));
  const busy = pendingAction !== null;

  if (isOffer && offerClosed) {
    return (
      <Banner
        tone="info"
        testID="job-offer-closed"
        message={
          countdown?.expired
            ? "This request timed out before it was answered and has gone to another partner."
            : "This request is no longer open for you. It was taken, withdrawn or has expired."
        }
      />
    );
  }

  if (!action || !label) return null;
  const loading = pendingAction === action;

  return (
    <View style={styles.wrap}>
      {isOffer && countdown ? (
        <T
          kind="smallStrong"
          numeric
          testID="job-offer-countdown"
          tone={countdown.urgency === "critical" ? "danger" : countdown.urgency === "warning" ? "warning" : "success"}
          accessibilityLiveRegion="none"
          style={styles.countdown}
        >
          {`Respond within ${formatCountdown(countdown.secondsLeft)}`}
        </T>
      ) : null}
      <View testID="job-primary-action">
        {/* `job-primary-cta` is the id the device scripts tap; keep it on the button itself. */}
        <Button testID="job-primary-cta" label={label} onPress={onPrimary} loading={loading} disabled={disabled || busy} hint={loading ? null : hint} />
      </View>
      {isOffer ? <Button testID="job-decline" label="Decline" variant="quiet" onPress={onDecline} disabled={busy} loading={pendingAction === "DECLINE"} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  countdown: { textAlign: "center" },
});
