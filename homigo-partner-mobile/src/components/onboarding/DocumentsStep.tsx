import { useEffect, useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { partnerRegistrationApi } from "@/services/partner-registration-api";
import { partnerColors } from "@/theme/colors";

const DOC_TYPES = [
  { id: "pan", label: "PAN certificate", hint: "Clear photo of PAN card" },
  { id: "aadhar", label: "Aadhaar card", hint: "Front side is enough" },
  { id: "bank_cheque", label: "Cancelled cheque", hint: "Used to verify payout account" },
] as const;

export function DocumentsStep({
  loading,
  onContinue,
}: {
  loading: boolean;
  onContinue: (uploaded: string[]) => void;
}) {
  const [uploaded, setUploaded] = useState<Set<string>>(new Set());
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void partnerRegistrationApi
      .listDocuments()
      .then((docs) => setUploaded(new Set(docs.map((d) => d.documentType))))
      .catch(() => undefined);
  }, []);

  async function pick(type: string, camera: boolean) {
    setMessage(null);
    const permission = camera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setMessage(camera ? "Camera permission is required." : "Photo library permission is required.");
      return;
    }
    const pickerOptions: ImagePicker.ImagePickerOptions = {
      mediaTypes: ["images"],
      quality: 0.7,
      base64: true,
      exif: false,
    };
    const result = camera
      ? await ImagePicker.launchCameraAsync(pickerOptions)
      : await ImagePicker.launchImageLibraryAsync(pickerOptions);
    if (result.canceled || !result.assets[0]?.base64) return;
    const asset = result.assets[0];
    setBusy(type);
    try {
      const mime = asset.mimeType ?? "image/jpeg";
      await partnerRegistrationApi.uploadDocument({
        file: `data:${mime};base64,${asset.base64}`,
        documentType: type,
        fileName: asset.fileName ?? `${type}.jpg`,
      });
      setUploaded((prev) => new Set(prev).add(type));
      if (asset.uri) setPreviews((prev) => ({ ...prev, [type]: asset.uri }));
      setMessage(`${type.replace(/_/g, " ")} uploaded`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Document upload failed. Try JPG or PNG.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Documents</Text>
      <Text style={styles.copy}>
        Photograph PAN, Aadhaar, and a cancelled cheque. You can skip and add them later — HQ still reviews the file.
      </Text>
      <Text style={styles.meta}>
        {uploaded.size} of {DOC_TYPES.length} uploaded
      </Text>
      {DOC_TYPES.map((doc) => (
        <View key={doc.id} style={styles.card}>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>{doc.label}</Text>
              <Text style={styles.hint}>{doc.hint}</Text>
            </View>
            {uploaded.has(doc.id) ? <Text style={styles.ok}>Uploaded</Text> : null}
          </View>
          {previews[doc.id] ? (
            <Image source={{ uri: previews[doc.id] }} style={styles.preview} />
          ) : null}
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={busy === doc.id ? "Uploading" : uploaded.has(doc.id) ? `Retake ${doc.label}` : `Camera ${doc.label}`}
              style={styles.ghost}
              onPress={() => void pick(doc.id, true)}
              disabled={busy === doc.id}
            >
              <Text style={styles.ghostText}>
                {busy === doc.id ? "Uploading…" : uploaded.has(doc.id) ? "Retake" : "Camera"}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={uploaded.has(doc.id) ? `Replace ${doc.label} from gallery` : `Gallery ${doc.label}`}
              style={styles.ghost}
              onPress={() => void pick(doc.id, false)}
              disabled={busy === doc.id}
            >
              <Text style={styles.ghostText}>{uploaded.has(doc.id) ? "Replace" : "Gallery"}</Text>
            </Pressable>
          </View>
        </View>
      ))}
      {message ? <Text style={styles.hint}>{message}</Text> : null}
      <Pressable
        accessibilityRole="button"
        style={styles.button}
        disabled={loading || Boolean(busy)}
        onPress={() => onContinue([...uploaded])}
      >
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Save & continue to assessment</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  title: { fontSize: 22, fontWeight: "800", color: partnerColors.text, letterSpacing: -0.3 },
  copy: { color: partnerColors.textSecondary, lineHeight: 20, fontSize: 14 },
  meta: { fontSize: 12, fontWeight: "700", color: partnerColors.primary },
  card: {
    borderWidth: 1,
    borderColor: partnerColors.line,
    borderRadius: 16,
    padding: 14,
    backgroundColor: "rgba(255,255,255,0.92)",
    gap: 10,
  },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 8 },
  label: { fontWeight: "700", color: partnerColors.text },
  ok: { color: "#059669", fontWeight: "700", fontSize: 12 },
  preview: { height: 120, borderRadius: 12, backgroundColor: "#e8efe9" },
  actions: { flexDirection: "row", gap: 8 },
  ghost: {
    flex: 1,
    borderWidth: 1,
    borderColor: partnerColors.line,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: "center",
  },
  ghostText: { fontWeight: "700", color: partnerColors.primary },
  hint: { color: partnerColors.textMuted, fontSize: 12, lineHeight: 16 },
  button: {
    backgroundColor: partnerColors.primary,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  buttonText: { color: "#fff", fontWeight: "700" },
});
