import { StyleSheet, View } from "react-native";
import { BulletList, SubHeading } from "@/components/job/parts";
import { T } from "@/components/ui";
import { stepItemsNotListed, uniqueStepItems } from "@/lib/job-brief";
import { space } from "@/theme/tokens";
import type { ExecutionStepView, PartnerBooking, PartnerRequirementLine } from "@/types/partner";

type BriefLine = PartnerRequirementLine & { check?: "CONFIRMED_BY_CUSTOMER" | "VERIFY_ON_ARRIVAL" | "VERIFY_AT_START" | "INFORMATIONAL" };

const CHECK_LABEL: Record<NonNullable<BriefLine["check"]>, string> = {
  CONFIRMED_BY_CUSTOMER: "confirmed by the customer",
  VERIFY_ON_ARRIVAL: "verify on arrival",
  VERIFY_AT_START: "verify before you start",
  INFORMATIONAL: "for your information",
};

/** One titled group of the booking's preparation lines; renders nothing when the group is empty. */
export function RequirementLines({ title, items }: { title: string; items: readonly BriefLine[] }) {
  if (items.length === 0) return null;
  return (
    <View style={styles.group}>
      <SubHeading>{title}</SubHeading>
      {items.map((r) => {
        const notes = [r.quantity, r.optional ? "optional" : null, r.chargeable ? "chargeable add-on" : null, r.check ? (CHECK_LABEL[r.check] ?? "for your information") : null].filter(Boolean);
        return (
          <View key={r.label} accessible accessibilityLabel={[r.label, ...notes, r.instructions].filter(Boolean).join(". ")}>
            <T kind="body">{r.label}</T>
            {notes.length ? <T kind="small">{notes.join(" · ")}</T> : null}
            {r.instructions ? <T kind="small">{r.instructions}</T> : null}
          </View>
        );
      })}
    </View>
  );
}

/**
 * Materials and equipment, from the three places the server names them and in its words: the
 * preparation lines frozen at booking (`requirements.bring…`), the service's own note
 * (`execution.materials` / `execution.equipment`), and anything a service step names that the lines
 * above do not already list. A part with nothing to say is not drawn, and when the server names
 * nothing at all the whole section is left out (`hasBringList`).
 */
function bringParts(booking: PartnerBooking, steps: readonly ExecutionStepView[] | undefined) {
  const bringMaterials = booking.requirements?.bringMaterials ?? [];
  const bringEquipment = booking.requirements?.bringEquipment ?? [];
  const materialsNote = booking.execution?.materials ?? null;
  const equipmentNote = booking.execution?.equipment ?? null;
  const stepMaterials = stepItemsNotListed(uniqueStepItems(steps, "materials"), bringMaterials.map((r) => r.label));
  const stepEquipment = stepItemsNotListed(uniqueStepItems(steps, "equipment"), bringEquipment.map((r) => r.label));
  const hasMaterials = bringMaterials.length > 0 || !!materialsNote || stepMaterials.length > 0;
  const hasEquipment = bringEquipment.length > 0 || !!equipmentNote || stepEquipment.length > 0;

  return { bringMaterials, bringEquipment, materialsNote, equipmentNote, stepMaterials, stepEquipment, hasMaterials, hasEquipment };
}

/** Whether the server names anything to bring for this job. */
export function hasBringList(booking: PartnerBooking, steps: readonly ExecutionStepView[] | undefined): boolean {
  const parts = bringParts(booking, steps);
  return parts.hasMaterials || parts.hasEquipment;
}

export function JobBringList({ booking, steps }: { booking: PartnerBooking; steps: readonly ExecutionStepView[] | undefined }) {
  const { bringMaterials, bringEquipment, materialsNote, equipmentNote, stepMaterials, stepEquipment, hasMaterials, hasEquipment } = bringParts(booking, steps);
  if (!hasMaterials && !hasEquipment) return null;
  return (
    <>
      {hasMaterials ? (
        <View style={styles.block} testID="job-materials">
          <T kind="bodyStrong" accessibilityRole="header">
            Materials
          </T>
          <RequirementLines title="Bring" items={bringMaterials} />
          {materialsNote ? <T kind="body">{materialsNote}</T> : null}
          <BulletList label="Named in the service steps" items={stepMaterials} />
        </View>
      ) : null}
      {hasEquipment ? (
        <View style={styles.block} testID="job-equipment">
          <T kind="bodyStrong" accessibilityRole="header">
            Equipment
          </T>
          <RequirementLines title="Bring" items={bringEquipment} />
          {equipmentNote ? <T kind="body">{equipmentNote}</T> : null}
          <BulletList label="Named in the service steps" items={stepEquipment} />
        </View>
      ) : null}
    </>
  );
}

/** How many things the job as a whole lists to bring — the closed section's one-line summary. */
export function bringCount(booking: PartnerBooking): number {
  return (booking.requirements?.bringMaterials.length ?? 0) + (booking.requirements?.bringEquipment.length ?? 0);
}

const styles = StyleSheet.create({
  group: { gap: space.xs },
  block: { gap: space.sm },
});
