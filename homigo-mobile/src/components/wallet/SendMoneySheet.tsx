import React, { useState } from "react";
import { Modal, View, Text, Pressable, StyleSheet, TextInput, ActivityIndicator } from "react-native";
import { X, Send, CheckCircle2, ShieldCheck } from "lucide-react-native";
import { useQueryClient } from "@tanstack/react-query";
import { useTheme } from "@/hooks/useTheme";
import { sheetHandle } from "@/lib/booking-ui";
import { spacing, radius } from "@/lib/typography";
import { PressableScale } from "@/components/ai/PressableScale";
import { coreApi } from "@/services/core/api";
import { qk } from "@/hooks/use-core-data";
import { useAppStore } from "@/lib/store";
import { AuthApiError } from "@/lib/auth/errors";

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const MIN = 1;
const MAX = 10000;
const ERR: Record<string, string> = {
  INSUFFICIENT_BALANCE: "Not enough wallet balance.",
  EXCEEDS_TXN_LIMIT: `Max ${inr(MAX)} per transfer.`,
  EXCEEDS_DAILY_LIMIT: "Daily transfer limit reached.",
  RECIPIENT_NOT_FOUND: "No Homeeigo user for that phone / email / code.",
  CANNOT_SEND_TO_SELF: "You can't send money to yourself.",
  INVALID_OTP: "Incorrect OTP. Try again.",
};

export function SendMoneySheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { colors: c } = useTheme();
  const qc = useQueryClient();
  const showToast = useAppStore((s) => s.showToast);
  const [step, setStep] = useState<"form" | "otp" | "success">("form");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [otp, setOtp] = useState("");
  const [transferId, setTransferId] = useState("");
  const [masked, setMasked] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amt = Number(amount);
  const formValid = recipient.trim().length >= 3 && amt >= MIN && amt <= MAX;

  const close = () => {
    onClose();
    setTimeout(() => {
      setStep("form");
      setRecipient("");
      setAmount("");
      setNote("");
      setOtp("");
      setError(null);
    }, 250);
  };

  const send = async () => {
    if (!formValid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await coreApi.transfers.initiate(recipient.trim(), amt, note.trim() || undefined);
      setTransferId(r.transferId);
      setMasked(r.recipient);
      if (r.devOtp) setOtp(r.devOtp);
      setStep("otp");
    } catch (e) {
      setError(e instanceof AuthApiError ? ERR[e.code ?? ""] ?? "Could not start the transfer." : "Could not start the transfer.");
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (otp.trim().length < 4 || busy) return;
    setBusy(true);
    setError(null);
    try {
      await coreApi.transfers.confirm(transferId, otp.trim());
      await Promise.all([
        qc.invalidateQueries({ queryKey: qk.walletBalance }),
        qc.invalidateQueries({ queryKey: qk.walletTx }),
      ]);
      setStep("success");
      showToast(`${inr(amt)} sent to ${masked}`);
    } catch (e) {
      setError(e instanceof AuthApiError ? ERR[e.code ?? ""] ?? "Could not complete the transfer." : "Could not complete the transfer.");
    } finally {
      setBusy(false);
    }
  };

  const field = (label: string, value: string, onChange: (t: string) => void, props?: object) => (
    <View>
      <Text style={[styles.label, { color: c.textSecondary }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholderTextColor={c.textSecondary}
        style={[styles.input, { color: c.text, backgroundColor: c.bg, borderColor: c.border }]}
        {...props}
      />
    </View>
  );

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close} />
      <View style={[styles.sheet, { backgroundColor: c.cardBg }]}>
        <View style={sheetHandle} />
        <View style={styles.head}>
          <Text style={[styles.title, { color: c.text }]}>
            {step === "success" ? "Done" : step === "otp" ? "Confirm transfer" : "Send money"}
          </Text>
          <Pressable onPress={close} hitSlop={12}>
            <X size={22} color={c.textSecondary} />
          </Pressable>
        </View>

        {step === "success" ? (
          <View style={styles.center}>
            <CheckCircle2 size={52} color={c.success} />
            <Text style={[styles.successTitle, { color: c.text }]}>Money sent</Text>
            <Text style={[styles.successSub, { color: c.textSecondary }]}>{inr(amt)} sent to {masked}.</Text>
            <PressableScale haptic onPress={close} style={[styles.btn, { backgroundColor: c.primary }]}>
              <Text style={styles.btnText}>Done</Text>
            </PressableScale>
          </View>
        ) : step === "otp" ? (
          <View style={{ gap: spacing.md }}>
            <View style={[styles.recapBox, { backgroundColor: c.bg, borderColor: c.border }]}>
              <Text style={[styles.recap, { color: c.text }]}>Sending {inr(amt)} to {masked}</Text>
            </View>
            {field("Enter the OTP sent to your phone", otp, (t) => setOtp(t.replace(/[^\d]/g, "").slice(0, 6)), {
              keyboardType: "number-pad",
              placeholder: "6-digit OTP",
            })}
            {error ? <Text style={[styles.err, { color: c.error }]}>{error}</Text> : null}
            <PressableScale haptic disabled={otp.trim().length < 4 || busy} onPress={() => void confirm()} style={[styles.btn, { backgroundColor: c.primary, opacity: otp.trim().length < 4 || busy ? 0.5 : 1 }]}>
              {busy && <ActivityIndicator size="small" color="#fff" />}
              <Text style={styles.btnText}>Confirm &amp; send</Text>
            </PressableScale>
          </View>
        ) : (
          <View style={{ gap: spacing.md }}>
            {field("Send to (phone, email or referral code)", recipient, setRecipient, { placeholder: "+91… / name@email / CODE", autoCapitalize: "none" })}
            {field("Amount (₹)", amount, (t) => setAmount(t.replace(/[^\d]/g, "").slice(0, 5)), { keyboardType: "number-pad", placeholder: `${MIN}–${MAX}` })}
            {field("Note (optional)", note, (t) => setNote(t.slice(0, 140)), { placeholder: "What's it for?" })}
            {error ? <Text style={[styles.err, { color: c.error }]}>{error}</Text> : null}
            <PressableScale haptic disabled={!formValid || busy} onPress={() => void send()} style={[styles.btn, { backgroundColor: c.primary, opacity: !formValid || busy ? 0.5 : 1 }]}>
              {busy ? <ActivityIndicator size="small" color="#fff" /> : <Send size={15} color="#fff" />}
              <Text style={styles.btnText}>{busy ? "Sending OTP…" : amt > 0 ? `Send ${inr(amt)}` : "Send money"}</Text>
            </PressableScale>
            <View style={styles.secure}>
              <ShieldCheck size={13} color={c.success} />
              <Text style={[styles.secureText, { color: c.textSecondary }]}>OTP-verified · instant to their wallet</Text>
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(15,23,42,0.45)" },
  sheet: { borderTopLeftRadius: radius["2xl"], borderTopRightRadius: radius["2xl"], paddingHorizontal: 20, paddingBottom: spacing["3xl"], maxHeight: "82%" },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.md },
  title: { fontSize: 18, fontWeight: "800" },
  label: { fontSize: 12, fontWeight: "600", marginBottom: 6 },
  input: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15, fontWeight: "600" },
  err: { fontSize: 12 },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 12, paddingVertical: 14, marginTop: 4 },
  btnText: { color: "#fff", fontSize: 15, fontWeight: "800" },
  recapBox: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md },
  recap: { fontSize: 14, fontWeight: "600" },
  center: { alignItems: "center", gap: 8, paddingVertical: spacing.xl },
  successTitle: { fontSize: 19, fontWeight: "800", marginTop: 4 },
  successSub: { fontSize: 13 },
  secure: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  secureText: { fontSize: 11 },
});
