import * as Linking from "expo-linking";
import { ClipboardList, MapPin, MessageCircle } from "lucide-react-native";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Collapsible } from "@/components/job/Collapsible";
import { SubHeading } from "@/components/job/parts";
import { Button, formatRupees, T } from "@/components/ui";
import { customerName } from "@/lib/format";
import { jobAccessDetails } from "@/lib/job-access";
import { formatMinutes } from "@/lib/job-brief";
import { mapsUrl } from "@/lib/job-screen";
import { jobSelectionRows } from "@/lib/job-selection";
import { isOfferStatus } from "@/lib/job-stage";
import { color, space } from "@/theme/tokens";
import type { PartnerBooking } from "@/types/partner";

/**
 * What the partner needs at the door, open by default: what was booked (service, option, quantity,
 * who it is for, add-ons, slot), where, how to get in, and how to reach the customer.
 *
 * Every line is the payload's. The address is the area only on an offer and after the job (the
 * server withholds the street, the pin and the access fields outside an active job) and nothing
 * older is shown in its place. The amount is labelled "Customer pays": it is the customer's price,
 * not the partner's earning. There is no call button: the server has no call relay for a partner,
 * so the masked number is shown as text with the note that points to chat.
 */
export function JobBrief({
  booking,
  phoneMasked,
  callNote,
  chatAvailable,
  onOpenChat,
}: {
  booking: PartnerBooking;
  /** The masked number the server sent (contact answer, else the booking's own). Never a full number. */
  phoneMasked: string | null;
  /** Why there is no call control, shown under the number. Null when there is nothing to say. */
  callNote: string | null;
  chatAvailable: boolean;
  onOpenChat: () => void;
}) {
  const [mapsError, setMapsError] = useState<string | null>(null);
  const rows = jobSelectionRows(booking);
  const access = jobAccessDetails(booking);
  const destination = mapsUrl(booking.address);
  const duration = booking.job?.duration ?? null;
  const offer = isOfferStatus(booking.status);

  async function openMaps() {
    if (!destination) return;
    setMapsError(null);
    try {
      await Linking.openURL(destination);
    } catch {
      setMapsError("Maps could not be opened on this phone.");
    }
  }

  return (
    <Collapsible title="Job brief" icon={ClipboardList} defaultOpen testID="job-brief">
      <View style={styles.rows}>
        {rows.map((r) => (
          <BriefRow key={r.key} label={r.label} value={r.value} testID={`job-brief-${r.key}`} />
        ))}
        {duration && (duration.preparationMinutes > 0 || duration.cleanupMinutes > 0) ? (
          <T kind="small">
            {`Prep ${formatMinutes(duration.preparationMinutes)} · service ${formatMinutes(duration.serviceMinutes)} · clean-up ${formatMinutes(duration.cleanupMinutes)}`}
          </T>
        ) : null}
        <BriefRow label="Customer" value={customerName(booking.customer)} testID="job-brief-customer" />
        {/* The customer's price. Never shown as the partner's pay. */}
        <BriefRow label="Customer pays" value={formatRupees(booking.finalAmount)} numeric testID="job-customer-pays" />
      </View>

      <View style={styles.block} testID="job-address">
        <SubHeading>Address</SubHeading>
        <T kind="body">{booking.address?.fullAddress ?? "—"}</T>
        {offer ? <T kind="small">The street address and access details are shown once you accept the job.</T> : null}
        {destination ? <Button label="Open in Maps" icon={MapPin} variant="secondary" onPress={() => void openMaps()} testID="job-open-maps" /> : null}
        {mapsError ? (
          <T kind="small" tone="danger" accessibilityRole="alert">
            {mapsError}
          </T>
        ) : null}
      </View>

      {access.length ? (
        <View style={styles.block} testID="job-access-details">
          <SubHeading>Getting in</SubHeading>
          {access.map((row) => (
            <View key={row.key} testID={`job-access-${row.key}`} accessible accessibilityLabel={`${row.label}: ${row.value}`}>
              <T kind="small">{row.label}</T>
              <T kind="body">{row.value}</T>
            </View>
          ))}
        </View>
      ) : null}

      {phoneMasked || callNote || chatAvailable ? (
        <View style={styles.block} testID="job-contact">
          <SubHeading>Contact</SubHeading>
          {phoneMasked ? <BriefRow label="Phone" value={phoneMasked} numeric testID="job-phone-masked" /> : null}
          {callNote ? (
            <T kind="small" testID="job-call-note">
              {callNote}
            </T>
          ) : null}
          {chatAvailable ? <Button label="Chat with customer" icon={MessageCircle} variant="secondary" onPress={onOpenChat} testID="job-chat-btn" /> : null}
        </View>
      ) : null}
    </Collapsible>
  );
}

/** Label on the left, value on the right; a long value wraps instead of pushing the label off. */
function BriefRow({ label, value, numeric, testID }: { label: string; value: string; numeric?: boolean; testID?: string }) {
  return (
    <View style={styles.row} accessible accessibilityLabel={`${label}: ${value}`}>
      <T kind="body" tone="slate" style={styles.rowLabel}>
        {label}
      </T>
      <T kind="bodyStrong" numeric={numeric} testID={testID} style={styles.rowValue}>
        {value}
      </T>
    </View>
  );
}

const styles = StyleSheet.create({
  rows: { gap: space.sm },
  row: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: space.lg },
  rowLabel: { flexShrink: 0, maxWidth: "40%" },
  rowValue: { flex: 1, textAlign: "right" },
  block: { gap: space.sm, paddingTop: space.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line },
});
