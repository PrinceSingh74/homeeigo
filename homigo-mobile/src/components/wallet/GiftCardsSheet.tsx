import React, { useState } from "react";
import { Modal, View, Text, Pressable, StyleSheet, ScrollView, TextInput, ActivityIndicator } from "react-native";
import { X, Gift, Ticket } from "lucide-react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useTheme } from "@/hooks/useTheme";
import { sheetHandle } from "@/lib/booking-ui";
import { spacing, radius } from "@/lib/typography";
import { PressableScale } from "@/components/ai/PressableScale";
import {
  useGiftDenominations,
  useMyGiftCards,
  useGiftCardPurchase,
  useRedeemGiftCard,
  useVoidGiftCard,
} from "@/hooks/use-giftcards";

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

export function GiftCardsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { colors: c } = useTheme();
  const [tab, setTab] = useState<"buy" | "mine">("buy");
  const { data: denoms } = useGiftDenominations();
  const { data: cards } = useMyGiftCards(visible);
  const { purchase, busy } = useGiftCardPurchase();
  const redeem = useRedeemGiftCard();
  const voidCard = useVoidGiftCard();

  const [amount, setAmount] = useState(500);
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [code, setCode] = useState("");
  const [redeemAmt, setRedeemAmt] = useState("");
  const [redeeming, setRedeeming] = useState(false);
  const [voidingId, setVoidingId] = useState<string | null>(null);

  const buy = () => {
    void purchase(amount, { recipientEmail: email.trim() || undefined, message: message.trim() || undefined }, () => setTab("mine"));
  };
  const doRedeem = async () => {
    if (code.trim().length < 4 || redeeming) return;
    setRedeeming(true);
    const partial = Number(redeemAmt) > 0 ? Number(redeemAmt) : undefined;
    const ok = await redeem(code.trim(), partial);
    if (ok) {
      setCode("");
      setRedeemAmt("");
    }
    setRedeeming(false);
  };
  const doVoid = async (id: string) => {
    if (voidingId) return;
    setVoidingId(id);
    await voidCard(id);
    setVoidingId(null);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: c.cardBg }]}>
        <View style={sheetHandle} />
        <View style={styles.head}>
          <Text style={[styles.title, { color: c.text }]}>Gift cards</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <X size={22} color={c.textSecondary} />
          </Pressable>
        </View>

        <View style={[styles.tabs, { backgroundColor: c.bg }]}>
          {(["buy", "mine"] as const).map((t) => (
            <Pressable key={t} onPress={() => setTab(t)} style={[styles.tab, tab === t && { backgroundColor: c.cardBg }]}>
              <Text style={[styles.tabText, { color: tab === t ? c.text : c.textSecondary }]}>
                {t === "buy" ? "Buy a card" : "My cards"}
              </Text>
            </Pressable>
          ))}
        </View>

        {tab === "buy" ? (
          <ScrollView contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing["3xl"] }}>
            <Text style={[styles.label, { color: c.textSecondary }]}>Choose amount</Text>
            <View style={styles.chips}>
              {(denoms ?? [100, 250, 500, 1000, 2000]).map((d) => {
                const active = amount === d;
                return (
                  <PressableScale key={d} haptic onPress={() => setAmount(d)} style={[styles.chip, { borderColor: active ? c.primary : c.border, backgroundColor: active ? c.primary : "transparent" }]}>
                    <Text style={[styles.chipText, { color: active ? "#fff" : c.primary }]}>{inr(d)}</Text>
                  </PressableScale>
                );
              })}
            </View>
            <LinearGradient colors={["#7C3AED", "#C026D3"]} style={styles.card}>
              <Gift size={24} color="#FFD700" />
              <Text style={styles.cardAmt}>{inr(amount)}</Text>
              <Text style={styles.cardLabel}>Homeeigo Gift Card</Text>
            </LinearGradient>
            <View>
              <Text style={[styles.label, { color: c.textSecondary }]}>Send to (email) — optional</Text>
              <TextInput value={email} onChangeText={setEmail} autoCapitalize="none" placeholder="friend@email.com" placeholderTextColor={c.textSecondary} style={[styles.input, { color: c.text, backgroundColor: c.bg, borderColor: c.border }]} />
            </View>
            <View>
              <Text style={[styles.label, { color: c.textSecondary }]}>Message — optional</Text>
              <TextInput value={message} onChangeText={(t) => setMessage(t.slice(0, 200))} placeholder="Happy birthday!" placeholderTextColor={c.textSecondary} style={[styles.input, { color: c.text, backgroundColor: c.bg, borderColor: c.border }]} />
            </View>
            <PressableScale haptic disabled={busy} onPress={buy} style={[styles.btn, { backgroundColor: c.primary, opacity: busy ? 0.5 : 1 }]}>
              {busy && <ActivityIndicator size="small" color="#fff" />}
              <Text style={styles.btnText}>Buy {inr(amount)} gift card</Text>
            </PressableScale>
          </ScrollView>
        ) : (
          <ScrollView contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing["3xl"] }}>
            <View style={[styles.redeemBox, { borderColor: c.border }]}>
              <View style={styles.redeemHead}>
                <Ticket size={14} color={c.primary} />
                <Text style={[styles.redeemTitle, { color: c.text }]}>Redeem a gift card</Text>
              </View>
              <View style={styles.redeemRow}>
                <TextInput value={code} onChangeText={(t) => setCode(t.toUpperCase())} autoCapitalize="none" placeholder="HG-XXXX-XXXX-XXXX" placeholderTextColor={c.textSecondary} style={[styles.input, { flex: 1, color: c.text, backgroundColor: c.bg, borderColor: c.border }]} />
                <TextInput value={redeemAmt} onChangeText={(t) => setRedeemAmt(t.replace(/[^\d]/g, "").slice(0, 5))} keyboardType="number-pad" placeholder="₹ all" placeholderTextColor={c.textSecondary} style={[styles.input, { width: 64, color: c.text, backgroundColor: c.bg, borderColor: c.border }]} />
                <PressableScale haptic disabled={code.trim().length < 4 || redeeming} onPress={() => void doRedeem()} style={[styles.redeemBtn, { backgroundColor: c.success, opacity: code.trim().length < 4 || redeeming ? 0.5 : 1 }]}>
                  <Text style={styles.redeemBtnText}>{redeeming ? "…" : "Redeem"}</Text>
                </PressableScale>
              </View>
              <Text style={[styles.rowSub, { color: c.textSecondary, marginTop: 6 }]}>Blank = full balance · or enter an amount for partial.</Text>
            </View>
            {!cards || cards.length === 0 ? (
              <Text style={[styles.empty, { color: c.textSecondary, borderColor: c.border }]}>No gift cards yet. Buy one or redeem a code.</Text>
            ) : (
              cards.map((card) => (
                <View key={card.id} style={[styles.row, { borderColor: c.border }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.code, { color: c.text }]}>{card.code}</Text>
                    <Text style={[styles.rowSub, { color: c.textSecondary }]}>
                      {card.role === "purchased" ? "Purchased" : "Received"}{card.recipient ? ` · to ${card.recipient}` : ""}
                    </Text>
                    {card.role === "purchased" && card.status === "ACTIVE" && (
                      <PressableScale haptic disabled={voidingId === card.id} onPress={() => void doVoid(card.id)}>
                        <Text style={{ color: c.error, fontSize: 11, fontWeight: "700", marginTop: 3 }}>
                          {voidingId === card.id ? "Refunding…" : "Void & refund"}
                        </Text>
                      </PressableScale>
                    )}
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={[styles.rowAmt, { color: c.text }]}>{inr(card.balance)}</Text>
                    {card.balance !== card.amount && (
                      <Text style={[styles.rowSub, { color: c.textSecondary }]}>of {inr(card.amount)}</Text>
                    )}
                    <View style={[styles.badge, { backgroundColor: card.status === "ACTIVE" ? `${c.success}26` : `${c.textSecondary}22` }]}>
                      <Text style={[styles.badgeText, { color: card.status === "ACTIVE" ? c.success : c.textSecondary }]}>{card.status}</Text>
                    </View>
                  </View>
                </View>
              ))
            )}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(15,23,42,0.45)" },
  sheet: { borderTopLeftRadius: radius["2xl"], borderTopRightRadius: radius["2xl"], paddingHorizontal: 20, paddingBottom: spacing["3xl"], maxHeight: "85%" },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.md },
  title: { fontSize: 18, fontWeight: "800" },
  tabs: { flexDirection: "row", gap: 4, borderRadius: 12, padding: 4, marginBottom: spacing.md },
  tab: { flex: 1, borderRadius: 9, paddingVertical: 7, alignItems: "center" },
  tabText: { fontSize: 14, fontWeight: "700" },
  label: { fontSize: 12, fontWeight: "600", marginBottom: 6 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7 },
  chipText: { fontSize: 13, fontWeight: "700" },
  card: { borderRadius: radius.lg, padding: spacing.lg, gap: 2 },
  cardAmt: { color: "#fff", fontSize: 24, fontWeight: "800", marginTop: 6 },
  cardLabel: { color: "rgba(255,255,255,0.8)", fontSize: 12 },
  input: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 12, paddingVertical: 14, marginTop: 4 },
  btnText: { color: "#fff", fontSize: 15, fontWeight: "800" },
  redeemBox: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md },
  redeemHead: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  redeemTitle: { fontSize: 13, fontWeight: "700" },
  redeemRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  redeemBtn: { borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11 },
  redeemBtnText: { color: "#fff", fontSize: 13, fontWeight: "800" },
  empty: { fontSize: 12, textAlign: "center", borderWidth: 1, borderStyle: "dashed", borderRadius: 12, paddingVertical: 18 },
  row: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 12, padding: spacing.md },
  code: { fontSize: 13, fontWeight: "700", fontFamily: "monospace" },
  rowSub: { fontSize: 11, marginTop: 2 },
  rowAmt: { fontSize: 14, fontWeight: "800" },
  badge: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, marginTop: 3 },
  badgeText: { fontSize: 9, fontWeight: "800" },
});
