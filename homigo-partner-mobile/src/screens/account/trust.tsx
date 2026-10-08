import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { Camera, FileText, Images, Lock } from "lucide-react-native";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Chips } from "@/components/account/controls";
import { AccountScreen, ErrorState, ListSkeleton, ResultBanner, RowsSkeleton, failure, type ActionResult } from "@/components/account/states";
import { Banner, Button, Card, EmptyState, Field, KeyValue, Pill, Sheet, T } from "@/components/ui";
import { useAuthed, useComplianceQuery, useProviderQuery, usePullRefresh } from "@/hooks/account/queries";
import { shrinkPickedPhoto } from "@/lib/shrink-photo";
import { DOCUMENT_TYPES, checkDocumentFile, documentState, documentTitle, isoDateOrNull } from "@/lib/account-rules";
import { formatDate } from "@/lib/format";
import { partnerApi } from "@/services/partner-api";
import { space } from "@/theme/tokens";
import type { PartnerDocument } from "@/types/partner";

/** Same picker rule as job evidence: a re-encoded JPEG, no EXIF, and on iOS the compatible representation (never HEIC). */
const PICKER: ImagePicker.ImagePickerOptions = {
  mediaTypes: ["images"],
  quality: 0.7,
  base64: true,
  exif: false,
  preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
};

type DocType = (typeof DOCUMENT_TYPES)[number]["id"];

/**
 * Upload a document, or a renewal — a renewal is a NEW upload of the same type (the server has no
 * "renew" route, and a verified document cannot be edited). The endpoint takes base64 or a data
 * URL of a PDF / JPEG / PNG / WebP up to 5 MB; this app can only take or choose a photo (there is
 * no file picker in the build), so PDFs are uploaded from the partner web app.
 */
function UploadSheet({ visible, onClose, initialType, onUploaded }: { visible: boolean; onClose: () => void; initialType: DocType | null; onUploaded: (message: string) => void }) {
  const qc = useQueryClient();
  const [type, setType] = useState<DocType | null>(initialType);
  const [expiry, setExpiry] = useState("");
  const [issuer, setIssuer] = useState("");
  const [problem, setProblem] = useState<ActionResult>(null);

  const upload = useMutation({
    mutationFn: async (source: "camera" | "library") => {
      if (!type) throw new Error("Choose which document this is.");
      const expiryDate = expiry.trim() ? isoDateOrNull(expiry) : null;
      if (expiry.trim() && !expiryDate) throw new Error("Write the expiry date as YYYY-MM-DD, for example 2027-03-31.");
      // Only the camera needs a permission. Choosing a photo goes through the system picker (Android
      // photo picker, iOS PHPicker), which hands over just the chosen photo and asks for nothing.
      if (source === "camera") {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) throw new Error("Camera access is off. Allow it in your phone's settings, or choose a photo instead.");
      }
      const picked = source === "camera" ? await ImagePicker.launchCameraAsync(PICKER) : await ImagePicker.launchImageLibraryAsync(PICKER);
      if (picked.canceled) return null;
      // A large capture is shrunk first (2000 px keeps a document legible and under the 5 MB limit).
      const asset = picked.assets[0] ? await shrinkPickedPhoto(picked.assets[0]) : undefined;
      const check = checkDocumentFile({ base64: asset?.base64 }, type);
      if (!check.ok) throw new Error(check.message);
      await partnerApi.documents.upload({
        file: check.file,
        documentType: type,
        fileName: check.fileName,
        ...(expiryDate ? { expiryDate } : {}),
        ...(issuer.trim() ? { issuer: issuer.trim() } : {}),
      });
      return type;
    },
    onMutate: () => setProblem(null),
    onSuccess: async (uploaded) => {
      if (!uploaded) return;
      await Promise.all([qc.invalidateQueries({ queryKey: ["partner", "documents"] }), qc.invalidateQueries({ queryKey: ["partner", "compliance"] })]);
      setExpiry("");
      setIssuer("");
      onUploaded(`${DOCUMENT_TYPES.find((t) => t.id === uploaded)?.label ?? "Document"} uploaded. It will be reviewed before it shows as verified.`);
      onClose();
    },
    onError: (e) => setProblem(failure(e, "The document could not be uploaded.")),
  });

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Upload a document"
      dismissable={!upload.isPending}
      testID="document-upload-sheet"
      footer={
        <>
          <Button label="Take a photo" icon={Camera} onPress={() => upload.mutate("camera")} loading={upload.isPending && upload.variables === "camera"} disabled={upload.isPending || !type} testID="document-take-photo" />
          <Button label="Choose a photo" icon={Images} variant="secondary" onPress={() => upload.mutate("library")} loading={upload.isPending && upload.variables === "library"} disabled={upload.isPending || !type} testID="document-choose-photo" />
        </>
      }
    >
      <T kind="smallStrong" tone="slate">
        Which document is this?
      </T>
      <Chips label="Document type" options={DOCUMENT_TYPES} value={type ? [type] : []} onToggle={setType} disabled={upload.isPending} testID="document-type" />
      <Field label="Expiry date (optional)" value={expiry} onChangeText={setExpiry} placeholder="YYYY-MM-DD" help="Leave empty if the document does not expire." keyboardType="numbers-and-punctuation" autoCorrect={false} testID="document-expiry" />
      <Field label="Issued by (optional)" value={issuer} onChangeText={setIssuer} maxLength={120} testID="document-issuer" />
      <T kind="small">A clear photo, JPEG or PNG, up to 5 MB. To replace or renew a document, upload it again under the same type.</T>
      <ResultBanner result={problem} testID="document-upload-error" />
    </Sheet>
  );
}

function DocumentCard({ doc, expiryState, daysToExpiry, onRenew }: { doc: PartnerDocument; expiryState: string | null; daysToExpiry: number | null; onRenew: () => void }) {
  const state = documentState(doc, Date.now(), expiryState);
  const known = DOCUMENT_TYPES.some((t) => t.id === doc.documentType.toLowerCase());
  return (
    <Card testID={`document-${doc.id}`}>
      <View style={styles.stack}>
        <View style={styles.head}>
          <T kind="heading" style={styles.flex}>
            {documentTitle(doc)}
          </T>
          <Pill label={state.label} tone={state.tone} icon={state.locked ? Lock : undefined} />
        </View>
        <KeyValue label="Uploaded" value={formatDate(doc.uploadedAt)} />
        <KeyValue label="Expires" value={doc.expiryDate ? `${formatDate(doc.expiryDate)}${typeof daysToExpiry === "number" && daysToExpiry >= 0 ? ` (${daysToExpiry} days)` : ""}` : "No expiry date recorded"} />
        {doc.issuer ? <KeyValue label="Issued by" value={doc.issuer} /> : null}
        {state.locked ? <T kind="small">A verified document cannot be changed. To renew it, upload a new one.</T> : null}
        {known ? <Button label={state.locked || state.label === "Expired" ? "Upload a renewal" : "Upload again"} variant="secondary" onPress={onRenew} accessibilityLabel={`Upload a new ${documentTitle(doc)}`} testID={`document-renew-${doc.id}`} /> : null}
      </View>
    </Card>
  );
}

export function TrustDocumentsScreen() {
  const enabled = useAuthed();
  const docs = useQuery({ queryKey: ["partner", "documents"], queryFn: () => partnerApi.documents.list(), enabled });
  const compliance = useComplianceQuery();
  const { refreshing, onRefresh } = usePullRefresh(docs, compliance);
  const [sheet, setSheet] = useState<{ type: DocType | null; key: number } | null>(null);
  const [result, setResult] = useState<ActionResult>(null);
  const expiry = new Map((compliance.data?.documents ?? []).map((d) => [d.id, d] as const));
  const openSheet = (type: DocType | null) => setSheet({ type, key: Date.now() });

  return (
    <AccountScreen
      title="Documents"
      refreshing={refreshing}
      onRefresh={onRefresh}
      footer={<Button label="Upload a document" onPress={() => openSheet(null)} testID="document-upload-open" />}
    >
      <ResultBanner result={result} testID="document-result" />
      {docs.isLoading ? (
        <ListSkeleton label="Loading your documents" />
      ) : !docs.data ? (
        <ErrorState error={docs.error} title="Your documents could not be loaded" onRetry={() => void docs.refetch()} />
      ) : docs.data.length === 0 ? (
        <EmptyState icon={FileText} title="No documents uploaded" message="Your identity and compliance documents appear here with their status and expiry. Upload one to get started." testID="documents-empty" />
      ) : (
        docs.data.map((d) => {
          const c = expiry.get(d.id);
          const known = DOCUMENT_TYPES.find((t) => t.id === d.documentType.toLowerCase());
          return <DocumentCard key={d.id} doc={d} expiryState={c?.expiryState ?? null} daysToExpiry={c?.daysToExpiry ?? null} onRenew={() => openSheet(known?.id ?? null)} />;
        })
      )}
      {sheet ? (
        <UploadSheet
          key={sheet.key}
          visible
          initialType={sheet.type}
          onClose={() => setSheet(null)}
          onUploaded={(message) => setResult({ tone: "success", message })}
        />
      ) : null}
    </AccountScreen>
  );
}

const words = (v: string | null | undefined) => (v ? v.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase()) : "—");

export function TrustVerificationScreen() {
  const compliance = useComplianceQuery();
  const provider = useProviderQuery();
  const { refreshing, onRefresh } = usePullRefresh(compliance, provider);
  const p = provider.data;
  const v = compliance.data?.verification;
  return (
    <AccountScreen title="Verification" refreshing={refreshing} onRefresh={onRefresh}>
      {provider.isLoading || compliance.isLoading ? (
        <RowsSkeleton label="Loading verification status" />
      ) : !p && !v ? (
        <ErrorState error={provider.error ?? compliance.error} title="Verification status could not be loaded" onRetry={onRefresh} />
      ) : (
        <>
          <Card>
            <KeyValue label="KYC status" value={words(p?.kycStatus ?? v?.kycStatus)} />
            <KeyValue label="Background check" value={words(p?.backgroundCheckStatus ?? v?.backgroundCheckStatus)} />
            {p ? <KeyValue label="Profile verified" value={p.isVerified ? "Yes" : "Not yet"} /> : null}
            {p ? <KeyValue label="Approved to take jobs" value={p.isApproved ? "Yes" : "Not yet"} /> : null}
          </Card>
          <T kind="small">These are set by the HOMEEIGO team after reviewing your documents. They cannot be changed from the app.</T>
          <Button label="Open documents" variant="secondary" onPress={() => router.push("/hq/trust-documents")} />
        </>
      )}
    </AccountScreen>
  );
}

/** The server's four compliance statuses, in plain words. Anything else is shown as sent. */
const STATUS_WORDS: Record<string, { label: string; tone: "success" | "warning" | "danger" }> = {
  VERIFIED: { label: "In good standing", tone: "success" },
  EXPIRING: { label: "Documents expiring", tone: "warning" },
  ACTION_REQUIRED: { label: "Action required", tone: "warning" },
  RESTRICTED: { label: "Restricted", tone: "danger" },
};

export function TrustComplianceScreen() {
  const compliance = useComplianceQuery();
  const { refreshing, onRefresh } = usePullRefresh(compliance);
  const c = compliance.data;
  if (compliance.isLoading) {
    return (
      <AccountScreen title="Compliance Center">
        <RowsSkeleton label="Loading compliance" />
      </AccountScreen>
    );
  }
  if (!c) {
    return (
      <AccountScreen title="Compliance Center" refreshing={refreshing} onRefresh={onRefresh}>
        <ErrorState error={compliance.error} title="Compliance could not be loaded" onRetry={() => void compliance.refetch()} />
      </AccountScreen>
    );
  }
  const status = STATUS_WORDS[c.status] ?? { label: words(c.status), tone: "warning" as const };
  const needAction = c.documents.filter((d) => d.cta && d.cta !== "View");
  return (
    <AccountScreen title="Compliance Center" refreshing={refreshing} onRefresh={onRefresh}>
      <Banner tone={c.restricted ? "danger" : status.tone} title={c.restricted ? "Restricted" : status.label} message={c.explanation} testID="compliance-status" />
      {c.restricted && c.restrictionReason ? <Banner tone="danger" title="Why your account is restricted" message={c.restrictionReason} /> : null}
      <Card>
        <KeyValue label="Account" value={c.restricted ? "Restricted" : "In good standing"} strong />
        <KeyValue label="KYC status" value={words(c.verification?.kycStatus)} />
        <KeyValue label="Background check" value={words(c.verification?.backgroundCheckStatus)} />
        <KeyValue label="Documents expiring soon" value={String(c.expiringSoon)} />
      </Card>
      <Card>
        <View style={styles.stack}>
          <T kind="heading" accessibilityRole="header">
            Documents
          </T>
          {c.documents.length === 0 ? (
            <T kind="small">No documents uploaded yet.</T>
          ) : (
            c.documents.map((d) => {
              const state = documentState(d, Date.now(), d.expiryState);
              return (
                <View key={d.id} style={styles.docRow}>
                  <View style={styles.flex}>
                    <T kind="bodyStrong">{documentTitle(d)}</T>
                    <T kind="small">{d.expiryDate ? `Expires ${formatDate(d.expiryDate)}` : "No expiry date recorded"}</T>
                  </View>
                  <Pill label={state.label} tone={state.tone} />
                </View>
              );
            })
          )}
          <Button label={needAction.length > 0 ? "Fix in documents" : "Open documents"} variant="secondary" onPress={() => router.push("/hq/trust-documents")} testID="compliance-open-documents" />
        </View>
      </Card>
    </AccountScreen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.sm },
  head: { flexDirection: "row", alignItems: "flex-start", gap: space.md },
  flex: { flex: 1 },
  docRow: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.xs },
});
