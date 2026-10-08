import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Chips } from "@/components/account/controls";
import { ResultBanner } from "@/components/account/states";
import { useDatedForm, useEquipmentForm, useLanguageForm, useSkillForm, type FormHandle } from "@/components/credentials/forms";
import { FormLabel } from "@/components/credentials/parts";
import { Button, KeyValue, Pill, Sheet, T } from "@/components/ui";
import { useCapabilityWrite, useDocumentsQuery } from "@/hooks/credentials/queries";
import type { CapabilityKind, RequirementCatalogue } from "@/lib/capabilities";
import { equipmentReportBody, type CredentialRowView, type Fact } from "@/lib/credentials-screen";
import { partnerApi } from "@/services/partner-api";
import { space } from "@/theme/tokens";
import type { PartnerCapabilityProfile, ProviderCertificationView, ProviderEquipmentView, ProviderInsuranceView } from "@/types/partner";

/**
 * The two sheets of "My credentials": add one, and one row's details with what the partner may still
 * do to it (edit the facts of a certification / insurance claim, report equipment as working or not,
 * remove a claim). Each is mounted only while open, so it always starts clean.
 */

const KINDS: ReadonlyArray<{ id: CapabilityKind; label: string }> = [
  { id: "skills", label: "Skill" },
  { id: "certifications", label: "Certification" },
  { id: "equipment", label: "Equipment" },
  { id: "insurance", label: "Insurance" },
  { id: "languages", label: "Language" },
];

type SheetProps = { onClose: () => void; /** The sentence to show on the screen once the server accepted the write. */ onDone: (message: string) => void };

function SubmitButton({ form, testID }: { form: FormHandle; testID: string }) {
  return <Button label={form.submitLabel} onPress={form.submit} loading={form.busy} disabled={form.disabled} hint={form.disabled ? form.why : null} testID={testID} />;
}

export function AddCredentialSheet({ profile, onClose, onDone }: SheetProps & { profile: PartnerCapabilityProfile }) {
  const [kind, setKind] = useState<CapabilityKind>("skills");
  const documents = useDocumentsQuery(kind === "certifications" || kind === "insurance");
  const done = (message: string) => {
    onDone(message);
    onClose();
  };
  const forms: Record<CapabilityKind, FormHandle> = {
    skills: useSkillForm(profile.skillCatalogue, done),
    certifications: useDatedForm("certifications", profile.requirementCatalogue, documents, done, onClose),
    equipment: useEquipmentForm(profile.requirementCatalogue, done),
    insurance: useDatedForm("insurance", profile.requirementCatalogue, documents, done, onClose),
    languages: useLanguageForm(done),
  };
  const form = forms[kind];
  const busy = Object.values(forms).some((f) => f.busy);
  return (
    <Sheet visible onClose={onClose} title="Add a credential" dismissable={!busy} testID="credential-add-sheet" footer={<SubmitButton form={form} testID="credential-add-submit" />}>
      <FormLabel>What are you adding?</FormLabel>
      <Chips label="What are you adding?" options={KINDS} value={[kind]} onToggle={setKind} disabled={busy} testID="credential-kind" />
      {form.body}
      <ResultBanner result={form.problem} testID="credential-add-error" />
    </Sheet>
  );
}

/** A value too long for one line sits under its label instead of beside it. */
const LONG_VALUE = 28;

function FactLine({ fact }: { fact: Fact }) {
  if (fact.value.length <= LONG_VALUE) return <KeyValue label={fact.label} value={fact.value} />;
  return (
    <View style={styles.longFact} accessible accessibilityLabel={`${fact.label}: ${fact.value}`}>
      <T kind="body" tone="slate">
        {fact.label}
      </T>
      <T kind="body">{fact.value}</T>
    </View>
  );
}

/** A certification or insurance row, with what its edit form needs. */
export type DatedTarget = { kind: "certifications" | "insurance"; row: ProviderCertificationView | ProviderInsuranceView; catalogue: RequirementCatalogue };

/**
 * One credential: everything the server holds about it, why it is locked when it is, and the actions
 * the row's state allows. Editing happens in this same sheet (one sheet, two steps), so a second
 * sheet never has to open over a closing one. The server stays the authority — a refusal is shown as
 * it arrives and the list is read again.
 */
export function CredentialDetailSheet({
  view,
  equipment,
  dated,
  onClose,
  onDone,
}: SheetProps & {
  view: CredentialRowView;
  /** The equipment row itself, when this is one: its working state can be reported. */
  equipment?: ProviderEquipmentView | null;
  /** The certification / insurance row itself, when this is one: its facts can be edited while it is a claim. */
  dated?: DatedTarget | null;
}) {
  const [step, setStep] = useState<"details" | "edit" | "remove">("details");
  const done = (message: string) => {
    onDone(message);
    onClose();
  };
  const documents = useDocumentsQuery(step === "edit");
  // Always called (hooks cannot be conditional); only used when this row is a dated one.
  const editForm = useDatedForm(dated?.kind ?? "certifications", dated?.catalogue, documents, done, onClose, dated?.row ?? null);
  const remove = useCapabilityWrite(
    () => partnerApi.capabilities.remove(view.kind, view.id),
    () => done(`${view.title} removed.`),
  );
  const report = useCapabilityWrite(
    (row: ProviderEquipmentView) => partnerApi.capabilities.declareEquipment(equipmentReportBody(row)),
    (res) =>
      done(
        res.changed === false
          ? `Nothing changed. ${view.title} was already marked this way.`
          : res.row.operational === "OUT_OF_SERVICE"
            ? `${view.title} is marked as out of service.`
            : `${view.title} is marked as working.`,
      ),
  );
  const busy = remove.busy || report.busy || editForm.busy;
  const working = equipment?.operational === "OPERATIONAL";
  const reportLabel = working ? "Report out of service" : "Report working again";
  const canEdit = view.perms.canEdit && Boolean(dated);

  if (step === "edit" && dated) {
    return (
      <Sheet
        visible
        onClose={onClose}
        title={`Edit ${view.title}`}
        dismissable={!busy}
        testID="credential-detail-sheet"
        footer={
          <>
            <SubmitButton form={editForm} testID="credential-edit-submit" />
            <Button label="Cancel" variant="quiet" onPress={() => setStep("details")} disabled={busy} />
          </>
        }
      >
        {editForm.body}
        <ResultBanner result={editForm.problem} testID="credential-edit-error" />
      </Sheet>
    );
  }

  const footer =
    step === "remove" ? (
      <>
        <Button label="Confirm remove" variant="danger" onPress={() => remove.run(undefined)} loading={remove.busy} accessibilityLabel={`Confirm removing ${view.title}`} testID="credential-remove-confirm" />
        <Button label="Keep" variant="quiet" onPress={() => setStep("details")} disabled={remove.busy} accessibilityLabel={`Keep ${view.title}`} />
      </>
    ) : (
      <>
        {canEdit ? <Button label="Edit details" variant="secondary" onPress={() => setStep("edit")} disabled={busy} accessibilityLabel={`Edit ${view.title}`} testID="credential-edit" /> : null}
        {view.perms.canReportOperational && equipment ? (
          <Button label={reportLabel} variant="secondary" onPress={() => report.run(equipment)} loading={report.busy} disabled={busy} accessibilityLabel={`${reportLabel}: ${view.title}`} testID="credential-report" />
        ) : null}
        {view.perms.canRemove ? <Button label="Remove" variant="danger" onPress={() => setStep("remove")} disabled={busy} accessibilityLabel={`Remove ${view.title}`} testID="credential-remove" /> : null}
        <Button label="Close" variant="quiet" onPress={onClose} disabled={busy} />
      </>
    );

  return (
    <Sheet visible onClose={onClose} title={view.title} dismissable={!busy} testID="credential-detail-sheet" footer={footer}>
      <View style={styles.pills}>
        <Pill label={view.pill.label} tone={view.pill.tone} />
        {view.attention ? <Pill label={view.attention.label} tone={view.attention.tone} /> : null}
      </View>
      <View>
        {view.facts.map((f) => (
          <FactLine key={f.label} fact={f} />
        ))}
      </View>
      {view.notes.map((n) => (
        <T key={n} kind="small">
          {n}
        </T>
      ))}
      {step === "remove" ? (
        <T kind="bodyStrong" accessibilityRole="alert">
          Remove {view.title} from your profile?
        </T>
      ) : null}
      <ResultBanner result={remove.problem ?? report.problem} testID="credential-detail-error" />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  pills: { flexDirection: "row", flexWrap: "wrap", gap: space.xs },
  longFact: { paddingVertical: space.sm, gap: space.xs / 2 },
});
