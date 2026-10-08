import * as ImagePicker from "expo-image-picker";
import { Camera, History, Images } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Linking, Platform } from "react-native";
import { Banner, Button, Sheet, T } from "@/components/ui";
import { checkEvidencePhoto, EVIDENCE_MAX_PHOTO_BYTES, EVIDENCE_TOO_LARGE_REMEDY } from "@/lib/evidence-photo";
import { shrinkPickedPhoto } from "@/lib/shrink-photo";

/** A photo that passed `checkEvidencePhoto`: ready to send, with something to show on screen. */
export type PickedEvidence = {
  /** `data:image/…;base64,…`, labelled by what the bytes are. */
  dataUrl: string;
  /** The picker's local file, for a preview before anything is uploaded. */
  previewUri: string | null;
  /** When it was picked: build the upload id from this ONCE, and reuse it on a retry. */
  pickedAtMs: number;
};

type Ask = { title: string; note?: string };

/**
 * The picker options the evidence rules need (see `lib/evidence-photo.ts` for why each is there):
 * re-encoded JPEG bytes, no EXIF, and the most compatible representation so an iPhone HEIC original
 * arrives as JPEG. A photo larger than 2000 px on its long edge is then shrunk on the phone
 * (`shrinkPickedPhoto`), so a high-megapixel camera cannot produce one the server refuses.
 */
const PICK_OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ["images"],
  quality: 0.7,
  base64: true,
  exif: false,
  preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
};

const CAMERA_DENIED = "Camera access is off for this app. Turn it on in Settings to take a photo, or choose one from your library.";
const LIBRARY_DENIED = "Photo access is off for this app. Turn it on in Settings to choose a photo, or take one with the camera.";

async function checkedAsset(picked: ImagePicker.ImagePickerAsset | undefined): Promise<{ ok: true; photo: PickedEvidence } | { ok: false; message: string }> {
  const asset = picked ? await shrinkPickedPhoto(picked) : undefined;
  const checked = checkEvidencePhoto({ base64: asset?.base64, mimeType: asset?.mimeType, uri: asset?.uri });
  if (!checked.ok) return { ok: false, message: checked.reason === "TOO_LARGE" ? `${checked.message} ${EVIDENCE_TOO_LARGE_REMEDY}` : checked.message };
  return { ok: true, photo: { dataUrl: checked.dataUrl, previewUri: asset?.uri ?? null, pickedAtMs: Date.now() } };
}

/**
 * Android can destroy the app's activity while the camera is in front (low memory). The photo the
 * partner took then comes back to a restarted app, where nothing is waiting for it. It is read ONCE
 * per process here and offered the next time a photo is asked for, so the capture is not lost.
 */
let pendingRead: Promise<PickedEvidence | null> | null = null;
let recoveredPhoto: PickedEvidence | null = null;
function readPendingCapture(): Promise<PickedEvidence | null> {
  if (Platform.OS !== "android") return Promise.resolve(null);
  pendingRead ??= ImagePicker.getPendingResultAsync()
    .then((result) => {
      if (!result || !("assets" in result) || result.canceled) return null;
      return checkedAsset(result.assets?.[0]).then((checked) => {
        recoveredPhoto = checked.ok ? checked.photo : null;
        return recoveredPhoto;
      });
    })
    .catch(() => null);
  return pendingRead;
}

/**
 * One way to add a job photo, used by every photo control on the job screen: a sheet that offers
 * the camera first and the library second, says so when a permission is denied (with a way into
 * Settings), and shows `checkEvidencePhoto`'s sentence for a HEIC, oversized or unreadable photo
 * BEFORE any request is made. Nothing is ever picked for the partner and nothing is skipped on a
 * timer: the promise settles only when a photo was chosen or the sheet was closed.
 *
 * Render `sheet` once; call `pick({ title })` to ask. Resolves `null` when the partner closes it.
 * `recovered` is true when a photo taken before the app was restarted is waiting to be used.
 */
export function usePhotoPicker(): { pick: (ask: Ask) => Promise<PickedEvidence | null>; sheet: ReactNode; recovered: boolean } {
  const [ask, setAsk] = useState<Ask | null>(null);
  const [busy, setBusy] = useState<"camera" | "library" | null>(null);
  const [problem, setProblem] = useState<{ message: string; settings: boolean } | null>(null);
  const [recovered, setRecovered] = useState<PickedEvidence | null>(recoveredPhoto);
  const resolver = useRef<((value: PickedEvidence | null) => void) | null>(null);

  useEffect(() => {
    let live = true;
    void readPendingCapture().then(() => {
      if (live) setRecovered(recoveredPhoto);
    });
    return () => {
      live = false;
    };
  }, []);

  const settle = useCallback((value: PickedEvidence | null) => {
    const resolve = resolver.current;
    resolver.current = null;
    setAsk(null);
    setBusy(null);
    setProblem(null);
    resolve?.(value);
  }, []);

  const pick = useCallback((next: Ask) => {
    // A second ask while one is open replaces it; the first resolves as "closed".
    resolver.current?.(null);
    setProblem(null);
    setBusy(null);
    setAsk(next);
    return new Promise<PickedEvidence | null>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  function useRecovered() {
    const photo = recovered;
    if (!photo) return;
    // Used once: it is the partner's choice which control it goes to.
    recoveredPhoto = null;
    setRecovered(null);
    settle({ ...photo, pickedAtMs: Date.now() });
  }

  async function run(source: "camera" | "library") {
    if (busy) return;
    setBusy(source);
    setProblem(null);
    try {
      if (source === "camera") {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          setProblem({ message: CAMERA_DENIED, settings: true });
          return;
        }
      }
      const result = source === "camera" ? await ImagePicker.launchCameraAsync(PICK_OPTIONS) : await ImagePicker.launchImageLibraryAsync(PICK_OPTIONS);
      if (result.canceled) return; // The partner backed out of the camera or the library: the sheet stays.
      const checked = await checkedAsset(result.assets?.[0]);
      if (!checked.ok) {
        setProblem({ message: checked.message, settings: false });
        return;
      }
      settle(checked.photo);
    } catch {
      // The picker throws when the OS refuses access outright (a denied library on older Androids).
      setProblem({ message: source === "camera" ? CAMERA_DENIED : LIBRARY_DENIED, settings: true });
    } finally {
      setBusy(null);
    }
  }

  const sheet = (
    <Sheet
      visible={ask !== null}
      onClose={() => settle(null)}
      title={ask?.title ?? "Add photo"}
      dismissable={busy === null}
      testID="job-photo-sheet"
      footer={
        <>
          {recovered ? <Button label="Use the photo you just took" icon={History} onPress={useRecovered} disabled={busy !== null} testID="job-photo-recovered" /> : null}
          <Button label="Take photo" icon={Camera} variant={recovered ? "secondary" : "primary"} onPress={() => void run("camera")} loading={busy === "camera"} disabled={busy !== null} testID="job-photo-camera" />
          <Button label="Choose from library" icon={Images} variant="secondary" onPress={() => void run("library")} loading={busy === "library"} disabled={busy !== null} testID="job-photo-library" />
          <Button label="Not now" variant="quiet" onPress={() => settle(null)} disabled={busy !== null} testID="job-photo-cancel" />
        </>
      }
    >
      {ask?.note ? <T kind="body" tone="slate">{ask.note}</T> : null}
      {recovered ? <Banner tone="info" testID="job-photo-recovered-note" message="The app restarted while the camera was open. The photo you took was kept." /> : null}
      <T kind="small">{`JPEG or PNG, up to ${EVIDENCE_MAX_PHOTO_BYTES / (1024 * 1024)} MB. The photo is checked before it is sent.`}</T>
      {problem ? (
        <Banner
          tone="warning"
          message={problem.message}
          testID="job-photo-problem"
          action={problem.settings ? <Button label="Open settings" variant="secondary" onPress={() => void Linking.openSettings()} testID="job-photo-settings" /> : undefined}
        />
      ) : null}
    </Sheet>
  );

  return { pick, sheet, recovered: recovered !== null };
}
