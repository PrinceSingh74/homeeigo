import React from "react";
import { View, Text, FlatList, ActivityIndicator } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { useTheme } from "@/hooks/useTheme";
import { parityApi, type Invoice } from "@/services/core/parity-api";

// Backend returns invoice amount in RUPEES (not paise).
const rupees = (amount: number) => `₹${amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

/** Membership / subscription invoices — backed by /api/subscriptions/invoices (same API as web). */
export default function InvoicesScreen() {
  const { colors: c } = useTheme();
  const invoicesQ = useQuery({ queryKey: ["invoices"], queryFn: () => parityApi.subscriptions.invoices() });

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <ScreenHeader title="Invoices" />
      <FlatList
        data={invoicesQ.data ?? []}
        keyExtractor={(i) => i.id}
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}
        renderItem={({ item }: { item: Invoice }) => (
          <View style={{ backgroundColor: c.cardBg, borderRadius: 14, borderWidth: 1, borderColor: c.border, padding: 16 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ fontWeight: "700", color: c.text }}>{item.invoiceNumber}</Text>
              <Text style={{ fontWeight: "700", color: c.text }}>{rupees(item.amount)}</Text>
            </View>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
              <Text style={{ fontSize: 12, color: c.textSecondary }}>{new Date(item.createdAt).toLocaleDateString()}</Text>
              <Text style={{ fontSize: 11, fontWeight: "700", color: item.status?.toLowerCase() === "paid" ? "#16A34A" : c.primary }}>{item.status}</Text>
            </View>
          </View>
        )}
        ListEmptyComponent={
          invoicesQ.isLoading ? (
            <ActivityIndicator style={{ marginTop: 24 }} color={c.primary} />
          ) : invoicesQ.isError ? (
            <Text style={{ textAlign: "center", color: "#DC2626", marginTop: 24 }}>Couldn't load invoices.</Text>
          ) : (
            <Text style={{ textAlign: "center", color: c.textSecondary, marginTop: 24 }}>No invoices yet.</Text>
          )
        }
      />
    </View>
  );
}
