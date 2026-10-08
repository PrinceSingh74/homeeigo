import { Camera, Check, Images } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { OnboardingFrame, Problem } from "@/components/onboarding/OnboardingFrame";
import { Banner, Button, Card, Pill, T } from "@/components/ui";
import { checkDocumentFile } from "@/lib/account-rules";
import { shrinkPickedPhoto } from "@/lib/shrink-photo";
import { registrationErrorSentence } from "@/lib/onboarding-form";
import { partnerRegistrationApi } from "@/services/partner-registration-api";
import { color, radius, space } from "@/theme/tokens";

const DOC_TYPES = [
  { id: "pan", label: "PAN certificate", hint: "A clear photo of your PAN card." },
  { id: "aadhar", label: "Aadhaar card", hint: "A clear photo of your Aadhaar card." },
  { id: "bank_cheque", label: "Cancelled cheque", hint: "A clear photo of a cancelled cheque." },
] as const;

type Note = { tone: "success" | "problem"; text: string };

/**
 * Step 7: one photo per document through `POST /documents/upload`, then
 * `POST /onboarding/documents` with the types uploaded. The server takes the step with any number
 * of them, so the applicant can continue without.
 */
export function DocumentsStep({ loading, onContinue }: { loading: boolean; onContinue: (uploaded: string[]) => void }) {
  const [uploaded, setUploaded] = useState<Set<string>>(new Set());
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<{ type: string; camera: boolean } | null>(null);
  const [notes, setNotes] = useState<Record<string, Note>>({});
  const [listProblem, setListProblem] = useState<string | null>(null);
  const [listing, setListing] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setListing(true);
    setListProblem(null);
    partnerRegistrationApi
      .listDocuments()
      .then((docs) => {
        // Added to what this visit already uploaded, never replacing it.
        if (!cancelled) setUploaded((prev) => new Set([...prev, ...docs.map((d) => d.documentType)]));
      })
      .catch((e) => {
        if (!cancelled) setListProblem(registrationErrorSentence(e, "The documents you already uploaded could not be checked."));
      })
      .finally(() => {
        if (!cancelled) setListing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  function note(type: string, value: Note | null) {
    setNotes((prev) => {
      const next = { ...prev };
      if (value) next[type] = value;
      else delete next[type];
      return next;
    });
  }

  async function pick(type: string, label: string, camera: boolean) {
    if (busy) return;
    note(type, null);
    // Only the camera needs a permission. The gallery is the system picker (Android photo picker,
    // iOS PHPicker), which hands over just the chosen photo and asks for nothing.
    if (camera) {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        note(type, { tone: "problem", text: "Camera permission denied. Use Gallery, or enable Camera in system settings." });
        return;
      }
    }
    const pickerOptions: ImagePicker.ImagePickerOptions = {
      mediaTypes: ["images"],
      quality: 0.7,
      base64: true,
      exif: false,
      // iOS library picks: ask for the compatible representation (JPEG rather than HEIC).
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    };
    const result = camera ? await ImagePicker.launchCameraAsync(pickerOptions) : await ImagePicker.launchImageLibraryAsync(pickerOptions);
    if (result.canceled) return;
    // A large capture is shrunk first (2000 px keeps a document legible and under the 5 MB limit).
    const asset = result.assets[0] ? await shrinkPickedPhoto(result.assets[0]) : undefined;
    // The data URL is labelled by what the bytes ARE, never by `asset.mimeType`: on Android the
    // bytes are re-encoded JPEG while the claimed type stays the source's (HEIC, PNG). The rule is the
    // endpoint's own (document-upload.service: JPEG / PNG / WebP by signature, 5 MB) — a photo it
    // would refuse is refused here, in words, before the upload.
    const check = checkDocumentFile({ base64: asset?.base64 }, type);
    if (!check.ok) {
      note(type, { tone: "problem", text: check.message });
      return;
    }
    setBusy({ type, camera });
    try {
      await partnerRegistrationApi.uploadDocument({ file: check.file, documentType: type, fileName: check.fileName });
      setUploaded((prev) => new Set(prev).add(type));
      if (asset?.uri) setPreviews((prev) => ({ ...prev, [type]: asset.uri }));
      note(type, { tone: "success", text: `${label} uploaded.` });
    } catch (e) {
      note(type, { tone: "problem", text: registrationErrorSentence(e, "The photo could not be uploaded. Try again.") });
    } finally {
      setBusy(null);
    }
  }

  const done = DOC_TYPES.filter((d) => uploaded.has(d.id)).length;

  return (
    <OnboardingFrame
      heading="Documents"
      lead="Take or choose a clear photo of each: JPEG, PNG or WebP, up to 5 MB. You can continue without them."
      primary={<Button label="Save & continue to assessment" onPress={() => onContinue([...uploaded])} loading={loading} disabled={Boolean(busy)} />}
    >
      <T kind="smallStrong" tone="slate" numeric>
        {listing ? "Checking your uploads…" : `${done} of ${DOC_TYPES.length} uploaded`}
      </T>
      {listProblem ? <Problem message={listProblem} onRetry={() => setReloadKey((k) => k + 1)} testID="onboarding-documents-list-problem" /> : null}
      {DOC_TYPES.map((doc) => {
        const has = uploaded.has(doc.id);
        const working = busy?.type === doc.id;
        const said = notes[doc.id];
        return (
          <Card key={doc.id} style={styles.card}>
            <View style={styles.head}>
              <View style={styles.headText}>
                <T kind="bodyStrong">{doc.label}</T>
                <T kind="small">{doc.hint}</T>
              </View>
              {has ? <Pill label="Uploaded" tone="success" icon={Check} /> : null}
            </View>
            {previews[doc.id] ? <Image accessibilityLabel={`${doc.label} photo`} source={{ uri: previews[doc.id] }} style={styles.preview} resizeMode="cover" /> : null}
            {said ? said.tone === "success" ? <Banner tone="success" message={said.text} /> : <Problem message={said.text} /> : null}
            <View style={styles.actions}>
              <Button
                label={has ? "Retake" : "Camera"}
                accessibilityLabel={working && busy?.camera ? "Uploading" : has ? `Retake ${doc.label}` : `Camera ${doc.label}`}
                variant="secondary"
                icon={Camera}
                onPress={() => void pick(doc.id, doc.label, true)}
                loading={working && busy?.camera === true}
                disabled={Boolean(busy)}
                style={styles.half}
              />
              <Button
                label={has ? "Replace" : "Gallery"}
                accessibilityLabel={working && busy?.camera === false ? "Uploading" : has ? `Replace ${doc.label} from gallery` : `Gallery ${doc.label}`}
                variant="secondary"
                icon={Images}
                onPress={() => void pick(doc.id, doc.label, false)}
                loading={working && busy?.camera === false}
                disabled={Boolean(busy)}
                style={styles.half}
              />
            </View>
          </Card>
        );
      })}
    </OnboardingFrame>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md },
  head: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: space.sm },
  headText: { flex: 1, gap: space.xs / 2 },
  preview: { width: "100%", height: 160, borderRadius: radius.control, backgroundColor: color.well },
  actions: { flexDirection: "row", gap: space.sm },
  half: { flex: 1 },
});
