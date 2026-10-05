import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { EmptyState, ErrorBlock, HqCard, HqCardTitle, HqMuted, LoadingBlock, StatRow } from "@/components/HqUi";
import { PartnerScreen } from "@/components/PartnerScreen";
import {
  CAPABILITY_NOT_DEPLOYED,
  EQUIPMENT_OPERATIONAL,
  EQUIPMENT_OWNERSHIP,
  LANGUAGE_CODE,
  LANGUAGE_PROFICIENCIES,
  SKILL_LEVELS,
  OTHER_CHOICE,
  capabilityStatusBadge,
  catalogueChoices,
  describeCapabilityError,
  requirementMark,
  resolveTypeCode,
  expiryHint,
  humanizeCode,
  humanizeEnum,
  languageBadge,
  parseDateInput,
  rowPermissions,
  toDateInput,
  type ExpiryHint,
  type RequirementCatalogue,
  type RequirementMark,
  type RowPermissions,
} from "@/lib/capabilities";
import { formatDate } from "@/lib/format";
import { PartnerApiError, partnerApi } from "@/services/partner-api";
import { useAuthStore } from "@/stores/auth-store";
import { partnerColors } from "@/theme/colors";
import type {
  CapabilityStatus,
  EquipmentOperational,
  EquipmentOwnership,
  LanguageProficiency,
  PartnerDocument,
  ProviderCertificationView,
  ProviderEquipmentView,
  ProviderInsuranceView,
  ProviderLanguageView,
  ProviderSkillView,
  SkillCatalogueEntry,
  SkillLevel,
} from "@/types/partner";

/**
 * Phase 11 — "My credentials": the partner's own skills, certifications, equipment, insurance and
 * languages (`/api/providers/me/capabilities`). The partner DECLARES; an administrator verifies; a
 * verified credential is locked. Every status, validity and near-expiry flag on this screen is the
 * server's — the pure mirrors in `lib/capabilities.ts` only decide which buttons to show, and the
 * server's refusal (409 `CAPABILITY_LOCKED` and the rest) is always shown as it arrives.
 */

const CAPABILITIES_KEY = ["partner", "capabilities"] as const;

/** One capability write: clears and maps its own error, and re-reads the profile either way. */
function useCapabilityAction<V>(fn: (vars: V) => Promise<unknown>, onDone?: () => void) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: fn,
    onMutate: () => setError(null),
    onSuccess: () => onDone?.(),
    onError: (e) =>
      setError(describeCapabilityError(e instanceof PartnerApiError ? e.code : null, e instanceof Error ? e.message : null)),
    // Also after a refusal: a CAPABILITY_LOCKED answer means the list on screen is out of date.
    onSettled: () => void qc.invalidateQueries({ queryKey: CAPABILITIES_KEY }),
  });
  return { run: mutation.mutate, busy: mutation.isPending, variables: mutation.variables, error, clearError: () => setError(null) };
}

export function MyCredentialsScreen() {
  const enabled = useAuthStore((s) => s.hydrated && Boolean(s.accessToken));
  const profile = useQuery({ queryKey: CAPABILITIES_KEY, queryFn: () => partnerApi.capabilities.profile(), enabled });
  // The partner's uploaded documents: a certification or insurance claim can point at one as proof.
  const documents = useQuery({ queryKey: ["partner", "documents"], queryFn: () => partnerApi.partnerOs.documents(), enabled });

  const subtitle = "Verified credentials make a professional eligible for jobs that require them.";

  if (profile.isLoading || profile.isPending) {
    return (
      <PartnerScreen title="My credentials" subtitle={subtitle} showBack>
        <LoadingBlock label="Loading your credentials…" />
      </PartnerScreen>
    );
  }

  if (profile.isError || !profile.data) {
    const notDeployed = profile.error instanceof PartnerApiError && profile.error.code === CAPABILITY_NOT_DEPLOYED;
    return (
      <PartnerScreen title="My credentials" subtitle={subtitle} showBack>
        <HqCard>
          {notDeployed ? (
            <EmptyState message="Coming soon — credentials are not switched on yet." />
          ) : (
            <>
              <ErrorBlock message="Could not load your credentials." />
              <Btn label="Try again" a11y="Try loading your credentials again" busy={profile.isFetching} onPress={() => void profile.refetch()} />
            </>
          )}
        </HqCard>
      </PartnerScreen>
    );
  }

  const p = profile.data;
  const docs = documents.data?.documents ?? [];

  return (
    <PartnerScreen title="My credentials" subtitle={subtitle} showBack>
      <View testID="credentials-screen">
        <HqCard>
          <HqCardTitle>How this works</HqCardTitle>
          <HqMuted>You declare a credential; the Homeeigo team reviews it. Once verified it is locked and counts towards the jobs you can be offered.</HqMuted>
          <View style={styles.summary} accessibilityLabel={`${p.summary.pendingReview} awaiting review, ${p.summary.nearExpiry} expiring within 30 days, ${p.summary.expired} expired`}>
            <StatRow label="○ Awaiting review" value={p.summary.pendingReview} />
            <StatRow label="⚠ Expiring within 30 days" value={p.summary.nearExpiry} />
            <StatRow label="✕ Expired or overdue" value={p.summary.expired} />
          </View>
        </HqCard>

        <SkillsGroup rows={p.skills} catalogue={p.skillCatalogue} />
        <DatedGroup config={CERTIFICATIONS} rows={p.certifications} documents={docs} catalogue={p.requirementCatalogue} />
        <EquipmentGroup rows={p.equipment} catalogue={p.requirementCatalogue} />
        <DatedGroup config={INSURANCE} rows={p.insurance} documents={docs} catalogue={p.requirementCatalogue} />
        <LanguagesGroup rows={p.languages} />
      </View>
    </PartnerScreen>
  );
}

/* ------------------------------------------------------------------ Skills */

type LevelChoice = SkillLevel | "NOT_STATED";
const LEVEL_CHOICES: readonly LevelChoice[] = ["NOT_STATED", ...SKILL_LEVELS];

function SkillsGroup({ rows, catalogue }: { rows: ProviderSkillView[]; catalogue: SkillCatalogueEntry[] }) {
  const [open, setOpen] = useState(false);
  const [skillCode, setSkillCode] = useState<string | null>(null);
  const [level, setLevel] = useState<LevelChoice>("NOT_STATED");
  const declare = useCapabilityAction(
    () => partnerApi.capabilities.declareSkill({ skillCode: skillCode!, level: level === "NOT_STATED" ? null : level }),
    () => { setOpen(false); setSkillCode(null); setLevel("NOT_STATED"); },
  );
  const remove = useCapabilityAction((id: number) => partnerApi.capabilities.remove("skills", id));

  return (
    <Group
      testID="credentials-skills"
      title="Skills"
      emptyText="No skills declared yet."
      isEmpty={rows.length === 0}
      addLabel="Add a skill"
      open={open}
      onToggle={() => { setOpen((v) => !v); declare.clearError(); }}
      error={remove.error}
      form={
        catalogue.length === 0 ? (
          <HqMuted>No skills are available to declare right now.</HqMuted>
        ) : (
          <>
            <View accessibilityRole="radiogroup" accessibilityLabel="Skill">
              <Text style={styles.fieldLabel}>Skill</Text>
              {catalogue.map((s) => {
                const on = skillCode === s.code;
                return (
                  <Pressable key={s.code} accessibilityRole="radio" accessibilityLabel={`${s.name}, ${s.category}`} accessibilityState={{ selected: on, checked: on }} onPress={() => setSkillCode(s.code)} style={[styles.choiceRow, on && styles.choiceOn]}>
                    <Text style={styles.choiceText}>{on ? "◉" : "○"} {s.name}</Text>
                    <Text style={styles.meta}>{s.category}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Choices label="Your level" options={LEVEL_CHOICES} value={level} onChange={setLevel} format={(v) => (v === "NOT_STATED" ? "Not stated" : humanizeEnum(v))} />
            <HqMuted>Adding a skill you already declared updates its level.</HqMuted>
            {declare.error ? <FormError message={declare.error} /> : null}
            <Btn primary label="Declare skill" a11y="Declare skill" disabled={!skillCode} busy={declare.busy} onPress={() => declare.run(undefined)} />
          </>
        )
      }
    >
      {rows.map((r) => (
        <CredentialRow
          key={r.id}
          testID={`credential-skills-${r.id}`}
          title={r.skillName || humanizeCode(r.skillCode)}
          badge={capabilityStatusBadge(r.status)}
          details={[
            `${r.skillCategory} · ${r.level ? `Level: ${humanizeEnum(r.level)}` : "Level not stated"}`,
            ...(r.skillActive ? [] : ["This skill is no longer offered in the catalogue."]),
          ]}
          expiry={expiryHint(r, new Date(), formatDate)}
          perms={rowPermissions("skills", r)}
          removeBusy={remove.busy && remove.variables === r.id}
          onRemove={() => remove.run(r.id)}
        />
      ))}
    </Group>
  );
}

/* ------------------------------------------- Certifications and insurance */

type DatedFacts = { org: string | null; ref: string | null; start: string | null; expiresAt: string | null; documentId: string | null };
type DatedRow = {
  id: number;
  status: CapabilityStatus;
  expiresAt: string | null;
  validity: string;
  nearExpiry: boolean;
  documentId: string | null;
  revokedReason: string | null;
};
type DatedConfig<R extends DatedRow> = {
  kind: "certifications" | "insurance";
  title: string;
  emptyText: string;
  addLabel: string;
  typeLabel: string;
  typePlaceholder: string;
  orgLabel: string;
  refLabel: string;
  startLabel: string;
  expiryRequired: boolean;
  type: (r: R) => string;
  org: (r: R) => string | null;
  ref: (r: R) => string | null;
  start: (r: R) => string | null;
  declare: (type: string, f: DatedFacts) => Promise<unknown>;
  edit: (rowId: number, f: DatedFacts) => Promise<unknown>;
};

const CERTIFICATIONS: DatedConfig<ProviderCertificationView> = {
  kind: "certifications",
  title: "Certifications",
  emptyText: "No certifications declared yet.",
  addLabel: "Add a certification",
  typeLabel: "Certificate or licence",
  typePlaceholder: "e.g. Electrical licence",
  orgLabel: "Issued by",
  refLabel: "Reference number",
  startLabel: "Issued on",
  expiryRequired: false,
  type: (r) => r.certificationType,
  org: (r) => r.issuer,
  ref: (r) => r.referenceNumber,
  start: (r) => r.issuedAt,
  declare: (type, f) =>
    partnerApi.capabilities.declareCertification({ certificationType: type, issuer: f.org, referenceNumber: f.ref, issuedAt: f.start, expiresAt: f.expiresAt, documentId: f.documentId }),
  edit: (rowId, f) =>
    partnerApi.capabilities.edit("certifications", rowId, { issuer: f.org, referenceNumber: f.ref, issuedAt: f.start, expiresAt: f.expiresAt, documentId: f.documentId }),
};

const INSURANCE: DatedConfig<ProviderInsuranceView> = {
  kind: "insurance",
  title: "Insurance",
  emptyText: "No insurance declared yet.",
  addLabel: "Add insurance",
  typeLabel: "Type of cover",
  typePlaceholder: "e.g. Public liability",
  orgLabel: "Insurer",
  refLabel: "Policy number",
  startLabel: "Effective from",
  expiryRequired: true,
  type: (r) => r.insuranceType,
  org: (r) => r.insurer,
  ref: (r) => r.policyReference,
  start: (r) => r.effectiveFrom,
  // `expiresAt` is required by the server for insurance; the form refuses to submit without it.
  declare: (type, f) =>
    partnerApi.capabilities.declareInsurance({ insuranceType: type, insurer: f.org, policyReference: f.ref, effectiveFrom: f.start, expiresAt: f.expiresAt ?? "", documentId: f.documentId }),
  edit: (rowId, f) =>
    partnerApi.capabilities.edit("insurance", rowId, { insurer: f.org, policyReference: f.ref, effectiveFrom: f.start, expiresAt: f.expiresAt, documentId: f.documentId }),
};

function DatedGroup<R extends DatedRow>({ config, rows, documents, catalogue }: { config: DatedConfig<R>; rows: R[]; documents: PartnerDocument[]; catalogue: RequirementCatalogue }) {
  // null = closed, "add" = declaring a new row, a number = editing that row's facts.
  const [mode, setMode] = useState<"add" | number | null>(null);
  // The codes services require, offered first; "Other…" (or no catalogue at all) is free entry.
  const choices = catalogueChoices(catalogue, config.kind);
  const [picked, setPicked] = useState<string | null>(null);
  const [typeName, setTypeName] = useState("");
  const [org, setOrg] = useState("");
  const [ref, setRef] = useState("");
  const [start, setStart] = useState("");
  const [expires, setExpires] = useState("");
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  function close() {
    setMode(null);
    setPicked(null);
    setTypeName(""); setOrg(""); setRef(""); setStart(""); setExpires(""); setDocumentId(null);
    setFormError(null);
  }
  const save = useCapabilityAction((v: { type: string; rowId: number | null; facts: DatedFacts }) => (v.rowId == null ? config.declare(v.type, v.facts) : config.edit(v.rowId, v.facts)), close);
  const remove = useCapabilityAction((id: number) => partnerApi.capabilities.remove(config.kind, id));

  function openEdit(r: R) {
    save.clearError();
    setFormError(null);
    setMode(r.id);
    setTypeName(humanizeCode(config.type(r)));
    setOrg(config.org(r) ?? "");
    setRef(config.ref(r) ?? "");
    setStart(toDateInput(config.start(r)));
    setExpires(toDateInput(r.expiresAt));
    setDocumentId(r.documentId);
  }

  const editing = typeof mode === "number";
  const freeEntry = choices.length === 0 || picked === OTHER_CHOICE;
  const code = resolveTypeCode(choices, picked, typeName);

  function submit() {
    const startDate = parseDateInput(start);
    const expiryDate = parseDateInput(expires);
    if (!editing && !code) return setFormError(freeEntry ? `Enter the ${config.typeLabel.toLowerCase()}.` : `Choose the ${config.typeLabel.toLowerCase()}.`);
    if (!startDate.ok || !expiryDate.ok) return setFormError("Enter dates as YYYY-MM-DD, for example 2027-03-31.");
    if (config.expiryRequired && !expiryDate.value) return setFormError("The expiry date is required.");
    if (startDate.value && expiryDate.value && expiryDate.value <= startDate.value) return setFormError("The expiry date must be after the start date.");
    setFormError(null);
    save.run({
      type: code,
      rowId: typeof mode === "number" ? mode : null,
      facts: { org: org.trim() || null, ref: ref.trim() || null, start: startDate.value, expiresAt: expiryDate.value, documentId },
    });
  }

  return (
    <Group
      testID={`credentials-${config.kind}`}
      title={config.title}
      emptyText={config.emptyText}
      isEmpty={rows.length === 0}
      addLabel={config.addLabel}
      open={mode !== null}
      onToggle={() => { if (mode !== null) close(); else { save.clearError(); setMode("add"); } }}
      error={remove.error}
      form={
        <>
          <Text style={styles.formTitle}>{editing ? `Edit ${typeName}` : config.addLabel}</Text>
          {editing ? (
            <HqMuted>Saving sends this entry back for review.</HqMuted>
          ) : (
            <TypePicker label={config.typeLabel} placeholder={config.typePlaceholder} choices={choices} picked={picked} onPick={setPicked} typeName={typeName} onTypeName={setTypeName} code={code} />
          )}
          <Field label={`${config.orgLabel} (optional)`} value={org} onChangeText={setOrg} maxLength={120} />
          <Field label={`${config.refLabel} (optional)`} value={ref} onChangeText={setRef} maxLength={120} />
          <Field label={`${config.startLabel} (optional)`} value={start} onChangeText={setStart} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" maxLength={10} />
          <Field label={config.expiryRequired ? "Expires on (required)" : "Expires on (optional)"} value={expires} onChangeText={setExpires} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" maxLength={10} />
          <View accessibilityRole="radiogroup" accessibilityLabel="Supporting document">
            <Text style={styles.fieldLabel}>Supporting document (optional)</Text>
            {documents.length === 0 ? (
              <HqMuted>You have no uploaded documents to attach.</HqMuted>
            ) : (
              [{ id: null as string | null, name: "None" }, ...documents.map((d) => ({ id: d.id as string | null, name: d.documentName || humanizeEnum(d.documentType) }))].map((d) => {
                const on = documentId === d.id;
                return (
                  <Pressable key={d.id ?? "none"} accessibilityRole="radio" accessibilityLabel={d.name} accessibilityState={{ selected: on, checked: on }} onPress={() => setDocumentId(d.id)} style={[styles.choiceRow, on && styles.choiceOn]}>
                    <Text style={styles.choiceText}>{on ? "◉" : "○"} {d.name}</Text>
                  </Pressable>
                );
              })
            )}
          </View>
          {formError || save.error ? <FormError message={(formError || save.error)!} /> : null}
          <View style={styles.actions}>
            <Btn primary label={editing ? "Save changes" : "Declare"} a11y={editing ? "Save changes" : config.addLabel} busy={save.busy} onPress={submit} />
            <Btn label="Cancel" a11y="Cancel" disabled={save.busy} onPress={close} />
          </View>
        </>
      }
    >
      {rows.map((r) => {
        const perms = rowPermissions(config.kind, r);
        const orgValue = config.org(r);
        const refValue = config.ref(r);
        const startValue = config.start(r);
        return (
          <CredentialRow
            key={r.id}
            testID={`credential-${config.kind}-${r.id}`}
            title={humanizeCode(config.type(r))}
            badge={capabilityStatusBadge(r.status)}
            mark={requirementMark(catalogue, config.kind, config.type(r))}
            details={[
              ...(orgValue ? [`${config.orgLabel}: ${orgValue}`] : []),
              ...(refValue ? [`${config.refLabel}: ${refValue}`] : []),
              ...(startValue ? [`${config.startLabel}: ${formatDate(startValue)}`] : []),
              ...(r.validity === "NOT_YET_EFFECTIVE" ? ["Not in effect yet."] : []),
              ...(r.status === "REVOKED" && r.revokedReason ? [`Reason: ${r.revokedReason}`] : []),
            ]}
            expiry={expiryHint(r, new Date(), formatDate)}
            perms={perms}
            removeBusy={remove.busy && remove.variables === r.id}
            onRemove={() => remove.run(r.id)}
          >
            {perms.canEdit ? <Btn label="Edit" a11y={`Edit ${humanizeCode(config.type(r))}`} onPress={() => openEdit(r)} /> : null}
          </CredentialRow>
        );
      })}
    </Group>
  );
}

/* --------------------------------------------------------------- Equipment */

function inspectionHint(r: ProviderEquipmentView): ExpiryHint | null {
  if (!r.inspectionDueAt) return null;
  const when = formatDate(r.inspectionDueAt);
  if (r.validity === "INSPECTION_OVERDUE") return { tone: "expired", glyph: "✕", text: `Inspection overdue — was due ${when}` };
  if (r.nearExpiry) return { tone: "soon", glyph: "⚠", text: `Inspection due soon — ${when}` };
  return { tone: "ok", glyph: "", text: `Next inspection due ${when}` };
}

function EquipmentGroup({ rows, catalogue }: { rows: ProviderEquipmentView[]; catalogue: RequirementCatalogue }) {
  const [open, setOpen] = useState(false);
  const choices = catalogueChoices(catalogue, "equipment");
  const [picked, setPicked] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [ownership, setOwnership] = useState<EquipmentOwnership>("OWNED");
  const [operational, setOperational] = useState<EquipmentOperational>("OPERATIONAL");
  const [note, setNote] = useState("");
  const code = resolveTypeCode(choices, picked, name);
  const declare = useCapabilityAction(
    () => partnerApi.capabilities.declareEquipment({ equipmentType: code, ownership, operational, note: note.trim() || null }),
    () => { setOpen(false); setPicked(null); setName(""); setOwnership("OWNED"); setOperational("OPERATIONAL"); setNote(""); },
  );
  // Reporting the working state re-declares the same item. On a VERIFIED row the server accepts only
  // a change of `operational` (same ownership, note left out); on a claim the stored note is resent
  // so it is not cleared.
  const report = useCapabilityAction((r: ProviderEquipmentView) =>
    partnerApi.capabilities.declareEquipment({
      equipmentType: r.equipmentType,
      ownership: r.ownership,
      operational: r.operational === "OPERATIONAL" ? "OUT_OF_SERVICE" : "OPERATIONAL",
      ...(r.status === "VERIFIED" ? {} : { note: r.note }),
    }),
  );
  const remove = useCapabilityAction((id: number) => partnerApi.capabilities.remove("equipment", id));

  return (
    <Group
      testID="credentials-equipment"
      title="Equipment"
      emptyText="No equipment declared yet."
      isEmpty={rows.length === 0}
      addLabel="Add equipment"
      open={open}
      onToggle={() => { setOpen((v) => !v); declare.clearError(); }}
      error={remove.error || report.error}
      form={
        <>
          <TypePicker label="Equipment" placeholder="e.g. Steam cleaner" choices={choices} picked={picked} onPick={setPicked} typeName={name} onTypeName={setName} code={code} />
          <Choices label="Ownership" options={EQUIPMENT_OWNERSHIP} value={ownership} onChange={setOwnership} format={humanizeEnum} />
          <Choices label="Condition" options={EQUIPMENT_OPERATIONAL} value={operational} onChange={setOperational} format={(v) => (v === "OPERATIONAL" ? "Working" : "Out of service")} />
          <Field label="Note (optional)" value={note} onChangeText={setNote} maxLength={300} />
          <HqMuted>Adding equipment you already declared updates it.</HqMuted>
          {declare.error ? <FormError message={declare.error} /> : null}
          <Btn primary label="Declare equipment" a11y="Declare equipment" disabled={!code} busy={declare.busy} onPress={() => declare.run(undefined)} />
        </>
      }
    >
      {rows.map((r) => {
        const perms = rowPermissions("equipment", r);
        const title = humanizeCode(r.equipmentType);
        const working = r.operational === "OPERATIONAL";
        return (
          <CredentialRow
            key={r.id}
            testID={`credential-equipment-${r.id}`}
            title={title}
            badge={capabilityStatusBadge(r.status)}
            mark={requirementMark(catalogue, "equipment", r.equipmentType)}
            details={[`${humanizeEnum(r.ownership)} · ${working ? "✓ Working" : "✕ Out of service"}`, ...(r.note ? [r.note] : [])]}
            expiry={inspectionHint(r)}
            perms={perms}
            removeBusy={remove.busy && remove.variables === r.id}
            onRemove={() => remove.run(r.id)}
          >
            {perms.canReportOperational ? (
              <Btn
                label={working ? "Report out of service" : "Report working again"}
                a11y={`${working ? "Report out of service" : "Report working again"}: ${title}`}
                busy={report.busy && report.variables?.id === r.id}
                onPress={() => report.run(r)}
              />
            ) : null}
          </CredentialRow>
        );
      })}
    </Group>
  );
}

/* --------------------------------------------------------------- Languages */

/** The language's English name where the runtime can supply it; otherwise the code itself. */
function languageName(code: string): string {
  try {
    const names = new Intl.DisplayNames(["en"], { type: "language" });
    return names.of(code) ?? code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}

function LanguagesGroup({ rows }: { rows: ProviderLanguageView[] }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [proficiency, setProficiency] = useState<LanguageProficiency>("CONVERSATIONAL");
  const cleaned = code.trim().toLowerCase();
  const valid = LANGUAGE_CODE.test(cleaned);
  const declare = useCapabilityAction(
    () => partnerApi.capabilities.declareLanguage({ languageCode: cleaned, proficiency }),
    () => { setOpen(false); setCode(""); setProficiency("CONVERSATIONAL"); },
  );
  const remove = useCapabilityAction((id: number) => partnerApi.capabilities.remove("languages", id));

  return (
    <Group
      testID="credentials-languages"
      title="Languages"
      emptyText="No languages declared yet."
      isEmpty={rows.length === 0}
      addLabel="Add a language"
      open={open}
      onToggle={() => { setOpen((v) => !v); declare.clearError(); }}
      error={remove.error}
      form={
        <>
          <Field
            label="Language code (two letters)"
            value={code}
            onChangeText={setCode}
            placeholder="e.g. hi, en, ta"
            hint={valid ? `Language: ${languageName(cleaned)}` : "Use the two-letter code, such as hi for Hindi."}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={2}
          />
          <Choices label="How well you speak it" options={LANGUAGE_PROFICIENCIES} value={proficiency} onChange={setProficiency} format={humanizeEnum} />
          <HqMuted>Adding a language you already declared updates it.</HqMuted>
          {declare.error ? <FormError message={declare.error} /> : null}
          <Btn primary label="Declare language" a11y="Declare language" disabled={!valid} busy={declare.busy} onPress={() => declare.run(undefined)} />
        </>
      }
    >
      {rows.map((r) => (
        <CredentialRow
          key={r.id}
          testID={`credential-languages-${r.id}`}
          title={`${languageName(r.languageCode)} (${r.languageCode.toUpperCase()})`}
          badge={languageBadge(r)}
          details={[humanizeEnum(r.proficiency)]}
          expiry={null}
          perms={rowPermissions("languages", r)}
          removeBusy={remove.busy && remove.variables === r.id}
          onRemove={() => remove.run(r.id)}
        />
      ))}
    </Group>
  );
}

/* ------------------------------------------------------------ Shared parts */

function Group({
  testID,
  title,
  emptyText,
  isEmpty,
  addLabel,
  open,
  onToggle,
  error,
  form,
  children,
}: {
  testID: string;
  title: string;
  emptyText: string;
  isEmpty: boolean;
  addLabel: string;
  open: boolean;
  onToggle: () => void;
  /** A refused row action (remove, report) — shown under the list it belongs to. */
  error?: string | null;
  form: ReactNode;
  children: ReactNode;
}) {
  return (
    <View testID={testID}>
      <HqCard>
        <Text style={styles.groupTitle} accessibilityRole="header">{title}</Text>
        {isEmpty ? <Text style={styles.empty}>{emptyText}</Text> : children}
        {error ? <FormError message={error} /> : null}
        {open ? <View style={styles.form}>{form}</View> : null}
        {/* The dated groups carry their own Cancel inside the form; this button opens and closes the rest. */}
        <View style={styles.addWrap}>
          <Btn label={open ? "Close" : addLabel} a11y={open ? `Close ${title.toLowerCase()} form` : addLabel} expanded={open} onPress={onToggle} />
        </View>
      </HqCard>
    </View>
  );
}

function CredentialRow({
  testID,
  title,
  badge,
  mark,
  details,
  expiry,
  perms,
  onRemove,
  removeBusy,
  children,
}: {
  testID: string;
  title: string;
  badge: { glyph: string; label: string };
  /** Whether a service currently requires this code — from the requirement catalogue only. */
  mark?: RequirementMark | null;
  details: string[];
  expiry: ExpiryHint | null;
  perms: RowPermissions;
  onRemove: () => void;
  removeBusy: boolean;
  children?: ReactNode;
}) {
  const [confirming, setConfirming] = useState(false);
  const summary = [`${title}: ${badge.label}`, ...(mark ? [mark.label] : []), ...details, ...(expiry ? [expiry.text] : []), ...(perms.hint ? [perms.hint] : [])].join(". ");
  return (
    <View style={styles.row} testID={testID}>
      <View accessible accessibilityLabel={summary}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.badge}>{badge.glyph} {badge.label}</Text>
        {mark ? <Text style={[styles.meta, mark.required ? styles.required : null]}>{mark.glyph} {mark.label}</Text> : null}
        {details.map((d, i) => (
          <Text key={`${i}-${d}`} style={styles.meta}>{d}</Text>
        ))}
        {expiry ? (
          <Text style={[styles.meta, expiry.tone === "expired" ? styles.expired : expiry.tone === "soon" ? styles.soon : null]}>
            {expiry.glyph ? `${expiry.glyph} ` : ""}{expiry.text}
          </Text>
        ) : null}
        {perms.hint ? <Text style={styles.meta}>{perms.locked ? "🔒 " : ""}{perms.hint}</Text> : null}
      </View>
      {children || perms.canRemove ? (
        <View style={styles.actions}>
          {children}
          {perms.canRemove ? (
            confirming ? (
              <>
                <Btn danger label="Confirm remove" a11y={`Confirm removing ${title}`} busy={removeBusy} onPress={onRemove} />
                <Btn label="Keep" a11y={`Keep ${title}`} disabled={removeBusy} onPress={() => setConfirming(false)} />
              </>
            ) : (
              <Btn label="Remove" a11y={`Remove ${title}`} onPress={() => setConfirming(true)} />
            )
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/**
 * The type of a new certification / equipment / insurance entry. With a requirement catalogue the
 * codes services ask for are the choices and "Other…" opens free entry; without one this is the
 * free-entry field alone — never an empty picker.
 */
function TypePicker({
  label,
  placeholder,
  choices,
  picked,
  onPick,
  typeName,
  onTypeName,
  code,
}: {
  label: string;
  placeholder: string;
  choices: ReadonlyArray<{ code: string; label: string }>;
  picked: string | null;
  onPick: (code: string) => void;
  typeName: string;
  onTypeName: (v: string) => void;
  code: string;
}) {
  const freeField = (
    <Field label={choices.length ? `${label} (other)` : label} value={typeName} onChangeText={onTypeName} placeholder={placeholder} hint={code ? `Saved as: ${code}` : undefined} maxLength={80} />
  );
  if (choices.length === 0) return freeField;
  return (
    <>
      <View accessibilityRole="radiogroup" accessibilityLabel={label}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <Text style={styles.meta}>◆ These are the ones services currently require.</Text>
        <View style={styles.pickList}>
          {[...choices, { code: OTHER_CHOICE, label: "Other…" }].map((c) => {
            const on = picked === c.code;
            return (
              <Pressable key={c.code} testID={`credential-type-${c.code === OTHER_CHOICE ? "other" : c.code}`} accessibilityRole="radio" accessibilityLabel={c.code === OTHER_CHOICE ? "Other, type it in" : c.label} accessibilityState={{ selected: on, checked: on }} onPress={() => onPick(c.code)} style={[styles.choiceRow, on && styles.choiceOn]}>
                <Text style={styles.choiceText}>{on ? "◉" : "○"} {c.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      {picked === OTHER_CHOICE ? freeField : null}
    </>
  );
}

function Choices<T extends string>({ label, options, value, onChange, format }: { label: string; options: readonly T[]; value: T; onChange: (v: T) => void; format: (v: T) => string }) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.choiceWrap}>
        {options.map((o) => {
          const on = value === o;
          return (
            <Pressable key={o} accessibilityRole="radio" accessibilityLabel={format(o)} accessibilityState={{ selected: on, checked: on }} onPress={() => onChange(o)} style={[styles.choice, on && styles.choiceOn]}>
              <Text style={styles.choiceText}>{on ? "◉" : "○"} {format(o)}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function Field({
  label,
  hint,
  ...input
}: {
  label: string;
  hint?: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  maxLength?: number;
  keyboardType?: "default" | "numbers-and-punctuation";
  autoCapitalize?: "none" | "sentences";
  autoCorrect?: boolean;
}) {
  return (
    <View>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput {...input} accessibilityLabel={label} placeholderTextColor={partnerColors.textMuted} style={styles.input} />
      {hint ? <Text style={styles.meta}>{hint}</Text> : null}
    </View>
  );
}

function FormError({ message }: { message: string }) {
  return (
    <Text style={styles.error} accessibilityRole="alert">
      ⚠ {message}
    </Text>
  );
}

function Btn({
  label,
  onPress,
  a11y,
  disabled,
  busy,
  primary,
  danger,
  expanded,
}: {
  label: string;
  onPress: () => void;
  a11y: string;
  disabled?: boolean;
  busy?: boolean;
  primary?: boolean;
  danger?: boolean;
  expanded?: boolean;
}) {
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ disabled: !!off, busy: !!busy, ...(expanded === undefined ? {} : { expanded }) }}
      disabled={off}
      onPress={onPress}
      style={[styles.btn, primary ? styles.btnPrimary : danger ? styles.btnDanger : styles.btnGhost, off && styles.btnDisabled]}
    >
      <Text style={primary ? styles.btnPrimaryText : danger ? styles.btnDangerText : styles.btnGhostText}>{busy ? "Working…" : label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  summary: { marginTop: 10 },
  groupTitle: { fontSize: 15, fontWeight: "700", color: partnerColors.text, marginBottom: 6 },
  empty: { fontSize: 13, lineHeight: 19, color: partnerColors.textMuted, paddingVertical: 6 },
  row: { paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: partnerColors.line },
  rowTitle: { fontSize: 14, fontWeight: "700", color: partnerColors.text },
  badge: { fontSize: 13, fontWeight: "600", color: partnerColors.text, marginTop: 2 },
  meta: { fontSize: 12, lineHeight: 17, color: partnerColors.textSecondary, marginTop: 2 },
  required: { color: partnerColors.text, fontWeight: "600" },
  pickList: { marginTop: 6 },
  expired: { color: partnerColors.danger, fontWeight: "600" },
  soon: { color: partnerColors.warning, fontWeight: "600" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  addWrap: { flexDirection: "row", marginTop: 12 },
  form: { gap: 10, marginTop: 12, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: partnerColors.line },
  formTitle: { fontSize: 14, fontWeight: "700", color: partnerColors.text },
  fieldLabel: { fontSize: 13, fontWeight: "600", color: partnerColors.text, marginBottom: 4 },
  input: { minHeight: 44, borderWidth: 1, borderColor: partnerColors.line, borderRadius: 12, paddingHorizontal: 12, color: partnerColors.text, backgroundColor: partnerColors.surface },
  choiceWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  choice: { minHeight: 44, justifyContent: "center", paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: partnerColors.line, backgroundColor: partnerColors.surface },
  choiceRow: { minHeight: 44, justifyContent: "center", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, borderWidth: 1, borderColor: partnerColors.line, backgroundColor: partnerColors.surface, marginBottom: 6 },
  choiceOn: { borderColor: partnerColors.primary, borderWidth: 2 },
  choiceText: { color: partnerColors.text, fontSize: 13 },
  error: { color: partnerColors.danger, fontSize: 12, lineHeight: 17, marginTop: 6 },
  btn: { minHeight: 44, paddingHorizontal: 14, justifyContent: "center", borderRadius: 12 },
  btnPrimary: { backgroundColor: partnerColors.primary },
  btnPrimaryText: { color: partnerColors.surface, fontWeight: "700", fontSize: 13 },
  btnGhost: { borderWidth: 1, borderColor: partnerColors.line },
  btnGhostText: { color: partnerColors.text, fontWeight: "700", fontSize: 13 },
  btnDanger: { borderWidth: 1, borderColor: partnerColors.danger },
  btnDangerText: { color: partnerColors.danger, fontWeight: "700", fontSize: 13 },
  btnDisabled: { opacity: 0.5 },
});
