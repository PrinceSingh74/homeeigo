import { BadgeCheck, Camera } from "lucide-react-native";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { Collapsible } from "@/components/job/Collapsible";
import { BulletList, CheckRow, PanelEmpty, SubHeading } from "@/components/job/parts";
import { Button, T } from "@/components/ui";
import type { CompletionProof } from "@/lib/job-screen";
import { PROFESSIONAL_CONFIRMATION_LABEL } from "@/lib/professional-confirmation";
import { color, space } from "@/theme/tokens";
import type { PartnerQualitySnapshot } from "@/types/partner";

/**
 * What "done" means for this job and what the partner must do before completing it: the completion
 * criteria, the FROZEN service checklist (tickable only while the work is in progress), the
 * professional's own confirmation where the policy asks for it, and the completion photo.
 *
 * Nothing is ticked for the partner. The ticks live on the screen so the Complete action sends
 * exactly what was ticked; `stillNeeded` are the rows the server named after it refused a
 * completion, shown unticked and flagged. The completion photo is asked for HERE, in words, with
 * the policy's requirement stated before the partner reaches the Complete button — it is never
 * requested by a picker that opens on its own and gives up on a timer.
 */
export function JobQuality({
  quality,
  inProgress,
  notStartedYet,
  ticked,
  stillNeeded,
  onTick,
  needsConfirmation,
  confirmed,
  confirmationDemanded,
  onToggleConfirmed,
  proof,
  stagedPhotos,
  onAddCompletionPhoto,
  children,
}: {
  quality: PartnerQualitySnapshot | null;
  inProgress: boolean;
  notStartedYet: boolean;
  ticked: readonly string[];
  stillNeeded: readonly string[];
  onTick: (item: string) => void;
  needsConfirmation: boolean;
  confirmed: boolean;
  confirmationDemanded: boolean;
  onToggleConfirmed: () => void;
  proof: CompletionProof;
  stagedPhotos: number;
  /** Null once as many photos are staged as one completion can carry. */
  onAddCompletionPhoto: (() => void) | null;
  /** The recorded verdict and reported issues (`QualityPanel`), for a job the partner holds. */
  children?: ReactNode;
}) {
  const checklist: readonly string[] = quality?.checklist ?? [];
  const criteria: readonly string[] = quality?.completionCriteria ?? [];
  const nothing = checklist.length === 0 && criteria.length === 0 && !needsConfirmation && !proof.required;
  const left = checklist.filter((item) => !ticked.includes(item)).length;
  const summary = inProgress && checklist.length ? (left === 0 ? "Every item ticked" : `${left} of ${checklist.length} left to tick`) : null;

  return (
    <Collapsible title="Quality checklist" icon={BadgeCheck} summary={summary} summaryTone={inProgress && left > 0 ? "warning" : undefined} defaultOpen={inProgress} testID="job-execution">
      {criteria.length ? <BulletList testID="job-completion-criteria" label="What done means" items={criteria} /> : null}

      {checklist.length ? (
        inProgress ? (
          <View testID="job-quality-checklist" style={styles.group}>
            <SubHeading>Checklist</SubHeading>
            <T kind="small">Tick each item as you finish it. All are needed to complete the job.</T>
            {checklist.map((item) => {
              const checked = ticked.includes(item);
              return (
                <CheckRow
                  key={item}
                  testID="job-checklist-item"
                  label={item}
                  checked={checked}
                  onPress={() => onTick(item)}
                  flag={stillNeeded.includes(item) && !checked ? "Still needed. The server did not receive this item." : null}
                />
              );
            })}
          </View>
        ) : (
          <BulletList label="Checklist" items={checklist} />
        )
      ) : null}

      {needsConfirmation && inProgress ? (
        <View testID="job-professional-confirmation-block" style={styles.block}>
          <SubHeading>Your confirmation (required)</SubHeading>
          <CheckRow
            testID="job-professional-confirmation"
            label={PROFESSIONAL_CONFIRMATION_LABEL}
            accessibilityLabel={`${PROFESSIONAL_CONFIRMATION_LABEL}. Required to complete this job.`}
            checked={confirmed}
            onPress={onToggleConfirmed}
            flag={confirmationDemanded && !confirmed ? "Still needed. The server did not receive your confirmation." : null}
          />
          <T kind="small">
            {`Tick this only when the work meets ${criteria.length ? "every point under “What done means”" : "the completion criteria for this service"}. The job cannot be completed without it.`}
          </T>
        </View>
      ) : needsConfirmation && notStartedYet ? (
        <T kind="small" testID="job-professional-confirmation-note">
          {`When you complete this job you will be asked to confirm: “${PROFESSIONAL_CONFIRMATION_LABEL}”.`}
        </T>
      ) : null}

      {inProgress ? (
        <View style={styles.block} testID="job-completion-photo">
          <SubHeading>Completion photo</SubHeading>
          <T kind="body" tone={proof.required ? "ink" : "slate"}>
            {proof.ask}
          </T>
          {stagedPhotos > 0 ? (
            <T kind="smallStrong" tone="success">
              {`${stagedPhotos} ${stagedPhotos === 1 ? "photo" : "photos"} ready. Sent when you complete the job. See them under Photos.`}
            </T>
          ) : null}
          {onAddCompletionPhoto ? (
            <Button
              label={stagedPhotos > 0 ? "Add another completion photo" : "Add completion photo"}
              icon={Camera}
              variant="secondary"
              onPress={onAddCompletionPhoto}
              testID="job-completion-photo-add"
            />
          ) : null}
        </View>
      ) : proof.required ? (
        <T kind="small" testID="job-before-after-required">
          {proof.ask}
        </T>
      ) : null}

      {nothing ? <PanelEmpty testID="job-quality-empty">This service has no quality checklist.</PanelEmpty> : null}
      {/* The panel draws its own divider, and nothing at all when the server has recorded nothing. */}
      {children}
    </Collapsible>
  );
}

const styles = StyleSheet.create({
  group: { gap: space.xs },
  block: { gap: space.sm, paddingTop: space.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line },
});
