import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { partnerApi } from "@/services/partner-api";
import { partnerColors } from "@/theme/colors";

const OTP_LENGTH = 6;

type SentInfo = {
  alreadyVerified: boolean;
  channels: string[];
  sentTo: { email: string | null; phone: string | null };
  resendInSec: number;
  expiresInSec: number;
};

/**
 * Proof-of-presence gate for Start job — mirrors partner-web StartJobOtpDialog.
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
  onStart: (otp?: string) => Promise<void>;
}) {
  const [digits, setDigits] = useState("");
  const [sent, setSent] = useState<SentInfo | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const startedRef = useRef(false);
  const dispatchedRef = useRef(false);

  const dispatchPin = useCallback(async () => {
    setSending(true);
    setSendError(null);
    try {
      const data = await partnerApi.startOtp(bookingId);
      setSent({
        alreadyVerified: data.alreadyVerified,
        channels: data.channels ?? [],
        sentTo: data.sentTo ?? { email: null, phone: null },
        resendInSec: data.resendInSec ?? 30,
        expiresInSec: data.expiresInSec ?? 600,
      });
      setResendIn(data.alreadyVerified ? 0 : data.resendInSec ?? 30);
      setDigits("");
      setVerifyError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not send PIN";
      if (/cooldown|resend/i.test(msg)) {
        setSent(
          (prev) =>
            prev ?? {
              alreadyVerified: false,
              channels: [],
              sentTo: { email: null, phone: null },
              resendInSec: 30,
              expiresInSec: 600,
            },
        );
        setResendIn(30);
      } else {
        setSendError(msg);
      }
    } finally {
      setSending(false);
    }
  }, [bookingId]);

  useEffect(() => {
    if (!visible) {
      dispatchedRef.current = false;
      startedRef.current = false;
      setDigits("");
      setSent(null);
      setSendError(null);
      setVerifyError(null);
      return;
    }
    if (dispatchedRef.current) return;
    dispatchedRef.current = true;
    void dispatchPin();
  }, [visible, dispatchPin]);

  useEffect(() => {
    if (!visible || resendIn <= 0) return;
    const t = setInterval(() => setResendIn((v) => (v > 0 ? v - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [visible, resendIn > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!visible || !sent?.alreadyVerified || startedRef.current) return;
    startedRef.current = true;
    void onStart(undefined)
      .then(onClose)
      .catch((err) => {
        startedRef.current = false;
        setVerifyError(err instanceof Error ? err.message : "Start failed");
      });
  }, [sent?.alreadyVerified, visible, onClose, onStart]);

  async function submit(code?: string) {
    if (verifying || startedRef.current) return;
    const otp = code ?? digits;
    if (otp.length !== OTP_LENGTH) return;
    setVerifying(true);
    setVerifyError(null);
    try {
      await onStart(otp);
      startedRef.current = true;
      onClose();
    } catch (err) {
      setVerifyError(err instanceof Error ? err.message : "Invalid PIN");
      setDigits("");
    } finally {
      setVerifying(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.title}>Customer verification</Text>
          <Text style={styles.sub}>Start PIN required to begin</Text>

          {sending && !sent ? (
            <View style={styles.center}>
              <ActivityIndicator color={partnerColors.primary} />
              <Text style={styles.muted}>Sending PIN to {customerName}…</Text>
            </View>
          ) : sendError ? (
            <View style={styles.center}>
              <Text style={styles.error}>{sendError}</Text>
              <Pressable onPress={() => void dispatchPin()} style={styles.primaryBtn}>
                <Text style={styles.primaryText}>Try again</Text>
              </Pressable>
            </View>
          ) : sent?.alreadyVerified ? (
            <View style={styles.center}>
              <ActivityIndicator color={partnerColors.success} />
              <Text style={styles.muted}>Already verified — starting…</Text>
              {verifyError ? <Text style={styles.error}>{verifyError}</Text> : null}
            </View>
          ) : (
            <>
              <Text style={styles.body}>
                Ask {customerName} for the 6-digit PIN we just sent them
                {sent?.sentTo.phone || sent?.sentTo.email
                  ? ` at ${[sent.sentTo.phone, sent.sentTo.email].filter(Boolean).join(" · ")}`
                  : ""}
                .
              </Text>
              <TextInput
                value={digits}
                onChangeText={(v) => {
                  const next = v.replace(/\D/g, "").slice(0, OTP_LENGTH);
                  setDigits(next);
                  if (next.length === OTP_LENGTH) void submit(next);
                }}
                keyboardType="number-pad"
                maxLength={OTP_LENGTH}
                placeholder="••••••"
                style={styles.pinInput}
                editable={!verifying}
                autoFocus
              />
              {verifyError ? <Text style={styles.error}>{verifyError}</Text> : null}
              <Pressable
                disabled={verifying || digits.length !== OTP_LENGTH}
                onPress={() => void submit()}
                style={[styles.primaryBtn, (verifying || digits.length !== OTP_LENGTH) && styles.disabled]}
              >
                {verifying ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.primaryText}>Verify & start job</Text>
                )}
              </Pressable>
              <Pressable
                disabled={resendIn > 0 || sending}
                onPress={() => void dispatchPin()}
                style={styles.resend}
              >
                <Text style={styles.resendText}>
                  {resendIn > 0 ? `Resend in ${resendIn}s` : "Resend PIN"}
                </Text>
              </Pressable>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  sheet: {
    backgroundColor: partnerColors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 32,
    gap: 10,
  },
  title: { fontSize: 17, fontWeight: "700", color: partnerColors.text },
  sub: { fontSize: 12, color: partnerColors.textMuted, marginBottom: 4 },
  body: { fontSize: 14, lineHeight: 20, color: partnerColors.textSecondary },
  muted: { fontSize: 13, color: partnerColors.textMuted, marginTop: 8 },
  error: { fontSize: 13, color: partnerColors.danger, marginTop: 4 },
  center: { alignItems: "center", paddingVertical: 24, gap: 8 },
  pinInput: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: partnerColors.line,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 22,
    letterSpacing: 8,
    textAlign: "center",
    fontWeight: "700",
    color: partnerColors.text,
    backgroundColor: partnerColors.cream,
  },
  primaryBtn: {
    marginTop: 8,
    backgroundColor: partnerColors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryText: { color: "#fff", fontWeight: "700" },
  disabled: { opacity: 0.5 },
  resend: { alignItems: "center", paddingVertical: 8 },
  resendText: { fontSize: 13, fontWeight: "600", color: partnerColors.primary },
});
