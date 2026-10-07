import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { KeyboardSpacer } from "@/components/job/parts";
import { Banner, Button, Sheet, T } from "@/components/ui";
import { attemptsLeftText, failureSentence, pinResendWait, pinSendLabel, refusalCode, startPinFailure, type StartPinFailure } from "@/lib/job-screen";
import { partnerApi } from "@/services/partner-api";
import { color, radius, space, tabular, touch, type } from "@/theme/tokens";

const PIN_LENGTH = 6;

/**
 * The start PIN — the customer's proof that the partner is at the door.
 *
 * Opening the sheet sends the PIN to the CUSTOMER (the partner is never told where it went). The
 * partner types the six digits the customer reads out; the sixth digit submits. Everything about
 * timing and attempts is the server's: "Resend in N s" counts down `resendInSec` from a send, or
 * `data.retryAfterSec` from a refused one; "N attempts left" is `data.attemptsLeft`; and the
 * sentences for a wrong, expired or locked PIN are the server's own.
 *
 * A start that fails for a reason that is not the PIN (position, a safety hold, a requirement) shows
 * the server's sentence here as well; position refusals also stay on the job screen behind it.
 */
export function StartJobOtpSheet({
  bookingId,
  customerName,
  visible,
  onClose,
  onStart,
}: {
  bookingId: string;
  customerName: string;
  visible: boolean;
  onClose: () => void;
  /** Sends the start. Rejects with the API error so the sheet can read its code and data. */
  onStart: (otp?: string) => Promise<void>;
}) {
  const [digits, setDigits] = useState("");
  const [sentOnce, setSentOnce] = useState(false);
  const [alreadyVerified, setAlreadyVerified] = useState(false);
  const [sending, setSending] = useState(false);
  /** The server's sentence about a send that was refused for timing (cooldown / rate limit). */
  const [sendNote, setSendNote] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [failure, setFailure] = useState<StartPinFailure | null>(null);
  /** When another PIN may be sent, on this device's clock; counted down once a second. */
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const openedFor = useRef<string | null>(null);
  const autoStarted = useRef(false);

  const waitSeconds = Math.max(0, Math.ceil((resendAt - now) / 1000));

  const sendPin = useCallback(async () => {
    setSending(true);
    setSendError(null);
    setSendNote(null);
    try {
      const data = await partnerApi.startOtp(bookingId);
      setSentOnce(true);
      setAlreadyVerified(data.alreadyVerified);
      setDigits("");
      setFailure(null);
      setNow(Date.now());
      setResendAt(data.alreadyVerified ? 0 : Date.now() + Math.max(0, data.resendInSec) * 1000);
    } catch (err) {
      const code = refusalCode(err);
      const wait = pinResendWait(err);
      if (code === "RESEND_COOLDOWN" || code === "RATE_LIMITED") {
        // The server's own wait; a cooldown also means a PIN is already with the customer.
        if (code === "RESEND_COOLDOWN") setSentOnce(true);
        setSendNote(failureSentence(err));
        setNow(Date.now());
        if (wait !== null) setResendAt(Date.now() + wait * 1000);
      } else {
        setSendError(failureSentence(err, "The PIN could not be sent. Please try again."));
      }
    } finally {
      setSending(false);
    }
  }, [bookingId]);

  // Opening sends the PIN once; closing forgets everything typed.
  useEffect(() => {
    if (!visible) {
      openedFor.current = null;
      autoStarted.current = false;
      setDigits("");
      setSentOnce(false);
      setAlreadyVerified(false);
      setSendNote(null);
      setSendError(null);
      setFailure(null);
      setResendAt(0);
      return;
    }
    if (openedFor.current === bookingId) return;
    openedFor.current = bookingId;
    void sendPin();
  }, [visible, bookingId, sendPin]);

  useEffect(() => {
    if (!visible || waitSeconds <= 0) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [visible, waitSeconds > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  // A ref, not the state: the sixth digit, a paste or an autofill and a tap on Verify can land in the
  // same frame, before `verifying` has rendered. Two requests burned two of the customer's attempts.
  const submitting = useRef(false);
  const submit = useCallback(
    async (otp: string | undefined) => {
      if (submitting.current) return;
      submitting.current = true;
      setVerifying(true);
      setFailure(null);
      try {
        await onStart(otp);
        onClose();
      } catch (err) {
        setFailure(startPinFailure(err));
        setDigits("");
      } finally {
        submitting.current = false;
        setVerifying(false);
      }
    },
    [onClose, onStart],
  );

  // The customer already gave the PIN (the server says so): start without asking for it again.
  useEffect(() => {
    if (!visible || !alreadyVerified || autoStarted.current) return;
    autoStarted.current = true;
    void submit(undefined);
  }, [visible, alreadyVerified, submit]);

  const attempts = attemptsLeftText(failure?.attemptsLeft ?? null);
  const locked = failure?.kind === "LOCKED";
  const canVerify = digits.length === PIN_LENGTH && !verifying && !locked;

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Start PIN"
      dismissable={!verifying}
      testID="start-pin-sheet"
      footer={
        alreadyVerified ? (
          failure ? <Button label="Try again" onPress={() => void submit(undefined)} loading={verifying} testID="start-pin-retry" /> : null
        ) : (
          <>
            <Button label="Verify and start job" onPress={() => void submit(digits)} loading={verifying} disabled={!canVerify} testID="start-pin-verify" />
            <Button
              label={sending ? "Sending PIN" : pinSendLabel(sentOnce, waitSeconds)}
              variant="quiet"
              onPress={() => void sendPin()}
              loading={sending}
              disabled={sending || verifying || waitSeconds > 0}
              testID="start-pin-send"
            />
            <KeyboardSpacer />
          </>
        )
      }
    >
      {alreadyVerified ? (
        <T kind="body" tone="slate" accessibilityLiveRegion="polite">
          {verifying ? "The customer has already confirmed the PIN. Starting the job." : "The customer has already confirmed the PIN."}
        </T>
      ) : (
        <>
          <T kind="body" tone="slate">
            {sending && !sentOnce
              ? `Sending the PIN to ${customerName}.`
              : `Ask ${customerName} for the 6-digit PIN. It was sent to the customer, not to you.`}
          </T>
          {sendNote ? <Banner tone="info" message={sendNote} testID="start-pin-send-note" /> : null}
          {sendError ? (
            <Banner
              tone="danger"
              message={sendError}
              testID="start-pin-send-error"
              action={<Button label="Try again" variant="secondary" onPress={() => void sendPin()} loading={sending} />}
            />
          ) : null}
          <View style={styles.field}>
            <T kind="smallStrong" tone="slate">
              Start PIN
            </T>
            <TextInput
              testID="start-pin-input"
              value={digits}
              onChangeText={(v) => {
                const next = v.replace(/\D/g, "").slice(0, PIN_LENGTH);
                setDigits(next);
                if (next.length === PIN_LENGTH && !locked) void submit(next);
              }}
              keyboardType="number-pad"
              inputMode="numeric"
              textContentType="oneTimeCode"
              autoComplete="one-time-code"
              importantForAutofill="yes"
              maxLength={PIN_LENGTH}
              editable={!verifying && !locked}
              autoFocus
              accessibilityLabel="Start PIN, 6 digits"
              accessibilityHint={failure?.message}
              placeholder="000000"
              placeholderTextColor={color.line}
              style={[styles.pin, failure ? styles.pinError : null]}
            />
          </View>
        </>
      )}
      {failure ? (
        <View accessible accessibilityRole="alert" accessibilityLiveRegion="assertive" style={styles.failure} testID="start-pin-error">
          <T kind="body" tone="danger">
            {failure.message}
          </T>
          {attempts ? (
            <T kind="smallStrong" numeric testID="start-pin-attempts">
              {attempts}
            </T>
          ) : null}
          {failure.needsNewPin && !alreadyVerified ? <T kind="small">Send a new PIN and ask the customer again.</T> : null}
        </View>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  field: { gap: space.xs + 2 },
  pin: {
    ...type.title,
    ...tabular,
    minHeight: touch.min + 12,
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.control,
    backgroundColor: color.well,
    paddingHorizontal: space.lg,
    textAlign: "center",
    letterSpacing: 10,
  },
  pinError: { borderColor: color.danger },
  failure: { gap: space.xs },
});
