import { router } from "expo-router";
import { useState, type ReactNode } from "react";
import { View, StyleSheet } from "react-native";
import { Chips } from "@/components/account/controls";
import { FormLabel, RadioRows } from "@/components/credentials/parts";
import { Button, Field, Skeleton, T } from "@/components/ui";
import { useCapabilityWrite } from "@/hooks/credentials/queries";
import { documentTitle } from "@/lib/account-rules";
import {
  EQUIPMENT_OPERATIONAL,
  EQUIPMENT_OWNERSHIP,
  LANGUAGE_CODE,
  LANGUAGE_PROFICIENCIES,
  OTHER_CHOICE,
  SKILL_LEVELS,
  catalogueChoices,
  humanizeEnum,
  resolveTypeCode,
  toDateInput,
  type RequirementCatalogue,
} from "@/lib/capabilities";
import { DATED_WORDS, LANGUAGE_OPTIONS, checkDatedForm, languageLabel, writeOutcome, type DatedFormCheck, type Failure } from "@/lib/credentials-screen";
import { errorSentence, isOfflineError, OFFLINE_SENTENCE } from "@/lib/error-sentence";
import { formatDate } from "@/lib/format";
import { partnerApi } from "@/services/partner-api";
import { space } from "@/theme/tokens";
import type {
  CapabilityWriteRow,
  EquipmentOperational,
  EquipmentOwnership,
  LanguageProficiency,
  PartnerDocument,
  ProviderCertificationView,
  ProviderInsuranceView,
  SkillCatalogueEntry,
  SkillLevel,
} from "@/types/partner";

/**
 * The five "add a credential" forms, each as a hook that returns its fields and its submit. The sheet
 * that hosts them owns the frame and the one primary button; a form owns its state, its checks and
 * its request. Bodies are exactly what `routes/provider-capabilities.ts` declares: fact fields only.
 */

export type FormHandle = {
  body: ReactNode;
  submitLabel: string;
  submit: () => void;
  busy: boolean;
  /** Nothing to send yet. `why` says what is missing, under the button. */
  disabled: boolean;
  why: string | null;
  problem: Failure | null;
};

/** Called with the sentence to show once the server has accepted the write. */
type Done = (message: string) => void;

const opt = <T extends string>(ids: readonly T[], label: (id: T) => string) => ids.map((id) => ({ id, label: label(id) }));

/* ------------------------------------------------------------------ skill */

type LevelChoice = SkillLevel | "NOT_STATED";
const LEVELS = opt<LevelChoice>(["NOT_STATED", ...SKILL_LEVELS], (v) => (v === "NOT_STATED" ? "Not stated" : humanizeEnum(v)));
/** Above this many skills the list gets a search field. */
const SEARCH_FROM = 8;

export function useSkillForm(catalogue: ReadonlyArray<SkillCatalogueEntry>, onDone: Done): FormHandle {
  const [skillCode, setSkillCode] = useState<string | null>(null);
  const [level, setLevel] = useState<LevelChoice>("NOT_STATED");
  const [search, setSearch] = useState("");
  const write = useCapabilityWrite(
    (code: string) => partnerApi.capabilities.declareSkill({ skillCode: code, level: level === "NOT_STATED" ? null : level }),
    (res) => onDone(writeOutcome("Skill", res)),
  );
  const q = search.trim().toLowerCase();
  const shown = q ? catalogue.filter((s) => s.name.toLowerCase().includes(q) || s.category.toLowerCase().includes(q)) : catalogue;
  const body =
    catalogue.length === 0 ? (
      <T kind="small">No skills are available to add right now.</T>
    ) : (
      <>
        <FormLabel>Skill</FormLabel>
        {catalogue.length > SEARCH_FROM ? <Field label="Search skills" value={search} onChangeText={setSearch} autoCapitalize="none" autoCorrect={false} testID="credential-skill-search" /> : null}
        {shown.length === 0 ? <T kind="small">No skills match that search.</T> : null}
        <RadioRows label="Skill" options={shown.map((s) => ({ id: s.code, label: s.name, detail: s.category, testID: `credential-skill-${s.code}` }))} value={skillCode} onChange={setSkillCode} disabled={write.busy} />
        <FormLabel>Your level</FormLabel>
        <Chips label="Your level" options={LEVELS} value={[level]} onToggle={setLevel} disabled={write.busy} testID="credential-skill-level" />
        <T kind="small">Adding a skill you already declared updates its level.</T>
      </>
    );
  return {
    body,
    submitLabel: "Add skill",
    submit: () => (skillCode ? write.run(skillCode) : undefined),
    busy: write.busy,
    disabled: !skillCode,
    why: catalogue.length === 0 || skillCode ? null : "Choose a skill first.",
    problem: write.problem,
  };
}

/* ------------------------------------------------------- type of an entry */

/**
 * The type of a new certification / equipment / insurance entry. With a requirement catalogue the
 * codes services ask for are the choices and "Other" opens free entry; without one this is the
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
  error,
  disabled,
}: {
  label: string;
  placeholder: string;
  choices: ReadonlyArray<{ code: string; label: string }>;
  picked: string | null;
  onPick: (code: string) => void;
  typeName: string;
  onTypeName: (v: string) => void;
  code: string;
  error?: string | null;
  disabled?: boolean;
}) {
  const free = (
    <Field label={choices.length ? `${label} (other)` : label} value={typeName} onChangeText={onTypeName} placeholder={placeholder} help={code ? `Saved as: ${code}` : undefined} error={error} maxLength={80} editable={!disabled} testID="credential-type-name" />
  );
  if (choices.length === 0) return free;
  return (
    <>
      <FormLabel>{label}</FormLabel>
      <T kind="small">These are the ones services currently require.</T>
      <RadioRows
        label={label}
        options={[...choices.map((c) => ({ id: c.code, label: c.label, testID: `credential-type-${c.code}` })), { id: OTHER_CHOICE, label: "Other", detail: "Type it in", testID: "credential-type-other" }]}
        value={picked}
        onChange={onPick}
        disabled={disabled}
      />
      {picked === OTHER_CHOICE ? (
        free
      ) : error ? (
        <T kind="small" tone="danger" accessibilityRole="alert">
          {error}
        </T>
      ) : null}
    </>
  );
}

/* ---------------------------------------------------- supporting document */

export type DocumentsRead = { data: PartnerDocument[] | undefined; isLoading: boolean; error: unknown; refetch: () => Promise<unknown> };

const NO_DOCUMENT = "__none__";

/** One of the partner's own uploaded documents as proof — optional. Uploading happens under Documents. */
function DocumentChoice({ documents, value, onChange, disabled, onLeave }: { documents: DocumentsRead; value: string | null; onChange: (id: string | null) => void; disabled?: boolean; onLeave: () => void }) {
  const openDocuments = () => {
    onLeave();
    router.push("/hq/trust-documents");
  };
  if (documents.data === undefined) {
    if (documents.isLoading) {
      return (
        <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading your documents" style={styles.stack}>
          <FormLabel>Supporting document (optional)</FormLabel>
          <Skeleton height={space.xxxl + space.lg} />
        </View>
      );
    }
    return (
      <View style={styles.stack}>
        <FormLabel>Supporting document (optional)</FormLabel>
        <T kind="small" tone="danger" accessibilityRole="alert">
          {isOfflineError(documents.error) ? OFFLINE_SENTENCE : `Your documents could not be loaded. ${errorSentence(documents.error, "")}`.trim()}
        </T>
        <Button label="Try again" variant="quiet" onPress={() => void documents.refetch()} accessibilityLabel="Try loading your documents again" />
      </View>
    );
  }
  if (documents.data.length === 0) {
    return (
      <View style={styles.stack}>
        <FormLabel>Supporting document (optional)</FormLabel>
        <T kind="small">You have no uploaded documents to attach. Upload one under Documents, then come back and attach it.</T>
        <Button label="Open documents" variant="quiet" onPress={openDocuments} testID="credential-open-documents" />
      </View>
    );
  }
  return (
    <View style={styles.stack}>
      <FormLabel>Supporting document (optional)</FormLabel>
      <RadioRows
        label="Supporting document"
        options={[{ id: NO_DOCUMENT, label: "None" }, ...documents.data.map((d) => ({ id: d.id, label: documentTitle(d), detail: `Uploaded ${formatDate(d.uploadedAt)}` }))]}
        value={value ?? NO_DOCUMENT}
        onChange={(id) => onChange(id === NO_DOCUMENT ? null : id)}
        disabled={disabled}
        testID="credential-document"
      />
    </View>
  );
}

/* ------------------------------------------- certification and insurance */

type DatedKind = "certifications" | "insurance";
type DatedRow = ProviderCertificationView | ProviderInsuranceView;
type DatedFacts = { org: string | null; ref: string | null; start: string | null; expiresAt: string | null; documentId: string | null };
type DatedWrite = { rowId: number | null; type: string; facts: DatedFacts };

function sendDated(kind: DatedKind, v: DatedWrite): Promise<{ row: CapabilityWriteRow; changed?: boolean }> {
  const f = v.facts;
  if (kind === "certifications") {
    const facts = { issuer: f.org, referenceNumber: f.ref, issuedAt: f.start, expiresAt: f.expiresAt, documentId: f.documentId };
    return v.rowId == null ? partnerApi.capabilities.declareCertification({ certificationType: v.type, ...facts }) : partnerApi.capabilities.edit("certifications", v.rowId, facts);
  }
  const facts = { insurer: f.org, policyReference: f.ref, effectiveFrom: f.start, documentId: f.documentId };
  // The form refuses to submit insurance without an expiry date (the server requires it).
  return v.rowId == null
    ? partnerApi.capabilities.declareInsurance({ insuranceType: v.type, ...facts, expiresAt: f.expiresAt ?? "" })
    : partnerApi.capabilities.edit("insurance", v.rowId, { ...facts, expiresAt: f.expiresAt });
}

/**
 * Certification or insurance: add one, or — with `editing` — change the facts of a claim (the type
 * is fixed; saving sends the row back for review).
 */
export function useDatedForm(kind: DatedKind, catalogue: RequirementCatalogue, documents: DocumentsRead, onDone: Done, onLeave: () => void, editing?: DatedRow | null): FormHandle {
  const words = DATED_WORDS[kind];
  const edit = editing ?? null;
  const editOrg = edit ? ("certificationType" in edit ? edit.issuer : edit.insurer) : null;
  const editRef = edit ? ("certificationType" in edit ? edit.referenceNumber : edit.policyReference) : null;
  const editStart = edit ? ("certificationType" in edit ? edit.issuedAt : edit.effectiveFrom) : null;
  // The codes services require, offered first; "Other" (or no catalogue at all) is free entry.
  const choices = catalogueChoices(catalogue, kind);
  const [picked, setPicked] = useState<string | null>(null);
  const [typeName, setTypeName] = useState("");
  const [org, setOrg] = useState(editOrg ?? "");
  const [ref, setRef] = useState(editRef ?? "");
  const [start, setStart] = useState(toDateInput(editStart));
  const [expires, setExpires] = useState(toDateInput(edit?.expiresAt));
  const [documentId, setDocumentId] = useState<string | null>(edit?.documentId ?? null);
  const [check, setCheck] = useState<Extract<DatedFormCheck, { ok: false }> | null>(null);
  const write = useCapabilityWrite((v: DatedWrite) => sendDated(kind, v), (res) => onDone(writeOutcome(words.noun, res)));

  const freeEntry = choices.length === 0 || picked === OTHER_CHOICE;
  const code = resolveTypeCode(choices, picked, typeName);
  const fieldError = (field: "type" | "start" | "expires") => (check?.field === field ? check.message : null);

  function submit() {
    const result = checkDatedForm({ editing: edit !== null, code, freeEntry, typeLabel: words.typeLabel, start, expires, expiryRequired: words.expiryRequired });
    if (!result.ok) {
      write.clearProblem();
      setCheck(result);
      return;
    }
    setCheck(null);
    write.run({ rowId: edit?.id ?? null, type: code, facts: { org: org.trim() || null, ref: ref.trim() || null, start: result.start, expiresAt: result.expires, documentId } });
  }

  const body = (
    <>
      {edit ? (
        <T kind="small">Saving sends this entry back for review.</T>
      ) : (
        <TypePicker label={words.typeLabel} placeholder={words.typePlaceholder} choices={choices} picked={picked} onPick={setPicked} typeName={typeName} onTypeName={setTypeName} code={code} error={fieldError("type")} disabled={write.busy} />
      )}
      <Field label={`${words.orgLabel} (optional)`} value={org} onChangeText={setOrg} maxLength={120} editable={!write.busy} testID="credential-org" />
      <Field label={`${words.refLabel} (optional)`} value={ref} onChangeText={setRef} maxLength={120} autoCorrect={false} editable={!write.busy} testID="credential-ref" />
      <Field label={`${words.startLabel} (optional)`} value={start} onChangeText={setStart} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" autoCorrect={false} maxLength={10} error={fieldError("start")} editable={!write.busy} testID="credential-start" />
      <Field
        label={words.expiryRequired ? "Expires on" : "Expires on (optional)"}
        value={expires}
        onChangeText={setExpires}
        placeholder="YYYY-MM-DD"
        keyboardType="numbers-and-punctuation"
        autoCorrect={false}
        maxLength={10}
        error={fieldError("expires")}
        help={words.expiryRequired ? undefined : "Leave empty if it does not expire."}
        editable={!write.busy}
        testID="credential-expires"
      />
      <DocumentChoice documents={documents} value={documentId} onChange={setDocumentId} disabled={write.busy} onLeave={onLeave} />
    </>
  );
  return { body, submitLabel: edit ? "Save changes" : kind === "certifications" ? "Add certification" : "Add insurance", submit, busy: write.busy, disabled: false, why: null, problem: write.problem };
}

/* -------------------------------------------------------------- equipment */

const OWNERSHIP = opt<EquipmentOwnership>(EQUIPMENT_OWNERSHIP, humanizeEnum);
const CONDITION = opt<EquipmentOperational>(EQUIPMENT_OPERATIONAL, (v) => (v === "OPERATIONAL" ? "Working" : "Out of service"));

export function useEquipmentForm(catalogue: RequirementCatalogue, onDone: Done): FormHandle {
  const choices = catalogueChoices(catalogue, "equipment");
  const [picked, setPicked] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [ownership, setOwnership] = useState<EquipmentOwnership>("OWNED");
  const [operational, setOperational] = useState<EquipmentOperational>("OPERATIONAL");
  const [note, setNote] = useState("");
  const code = resolveTypeCode(choices, picked, name);
  const write = useCapabilityWrite(
    (equipmentType: string) => partnerApi.capabilities.declareEquipment({ equipmentType, ownership, operational, note: note.trim() || null }),
    (res) => onDone(writeOutcome("Equipment", res)),
  );
  const body = (
    <>
      <TypePicker label="Equipment" placeholder="For example: Steam cleaner" choices={choices} picked={picked} onPick={setPicked} typeName={name} onTypeName={setName} code={code} disabled={write.busy} />
      <FormLabel>Ownership</FormLabel>
      <Chips label="Ownership" options={OWNERSHIP} value={[ownership]} onToggle={setOwnership} disabled={write.busy} testID="credential-ownership" />
      <FormLabel>Condition</FormLabel>
      <Chips label="Condition" options={CONDITION} value={[operational]} onToggle={setOperational} disabled={write.busy} testID="credential-condition" />
      <Field label="Note (optional)" value={note} onChangeText={setNote} maxLength={300} multiline editable={!write.busy} testID="credential-note" />
      <T kind="small">Adding equipment you already declared updates it.</T>
    </>
  );
  return { body, submitLabel: "Add equipment", submit: () => (code ? write.run(code) : undefined), busy: write.busy, disabled: !code, why: code ? null : choices.length === 0 || picked === OTHER_CHOICE ? "Enter the equipment first." : "Choose the equipment first.", problem: write.problem };
}

/* --------------------------------------------------------------- language */

const LANGUAGES = [...LANGUAGE_OPTIONS.map((l) => ({ id: l.code, label: l.name })), { id: OTHER_CHOICE, label: "Other" }];
const PROFICIENCY = opt<LanguageProficiency>(LANGUAGE_PROFICIENCIES, humanizeEnum);

export function useLanguageForm(onDone: Done): FormHandle {
  const [picked, setPicked] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [proficiency, setProficiency] = useState<LanguageProficiency>("CONVERSATIONAL");
  const code = picked === OTHER_CHOICE ? typed.trim().toLowerCase() : (picked ?? "");
  const valid = LANGUAGE_CODE.test(code);
  const write = useCapabilityWrite(
    (languageCode: string) => partnerApi.capabilities.declareLanguage({ languageCode, proficiency }),
    (res, languageCode) => onDone(writeOutcome(languageLabel(languageCode), res)),
  );
  const body = (
    <>
      <FormLabel>Language</FormLabel>
      <Chips label="Language" options={LANGUAGES} value={picked ? [picked] : []} onToggle={setPicked} disabled={write.busy} testID="credential-language" />
      {picked === OTHER_CHOICE ? (
        <Field label="Language code (two letters)" value={typed} onChangeText={setTyped} placeholder="For example: fr" help="Use the two-letter code of the language." autoCapitalize="none" autoCorrect={false} maxLength={2} editable={!write.busy} testID="credential-language-code" />
      ) : null}
      <FormLabel>How well you speak it</FormLabel>
      <Chips label="How well you speak it" options={PROFICIENCY} value={[proficiency]} onToggle={setProficiency} disabled={write.busy} testID="credential-proficiency" />
      <T kind="small">Adding a language you already declared updates it.</T>
    </>
  );
  return { body, submitLabel: "Add language", submit: () => (valid ? write.run(code) : undefined), busy: write.busy, disabled: !valid, why: valid ? null : picked === OTHER_CHOICE ? "Enter the two-letter code first." : "Choose a language first.", problem: write.problem };
}

const styles = StyleSheet.create({
  stack: { gap: space.sm },
});
