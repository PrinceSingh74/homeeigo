import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import { resizeTarget } from "@/lib/evidence-photo";

/** The fields of a picked image this needs (an `ImagePickerAsset` has them all). */
export type ShrinkablePhoto = {
  uri?: string | null;
  base64?: string | null;
  mimeType?: string | null;
  width?: number | null;
  height?: number | null;
};

/**
 * A picked photo, shrunk to the app's long-edge limit when it is larger (`resizeTarget`), as JPEG
 * with its bytes. A photo within the limit comes back exactly as it was picked. If the resize
 * fails for any reason the original is returned: the byte check that follows still decides whether
 * it can be sent, so a failed resize can never let through something the server would refuse.
 */
export async function shrinkPickedPhoto<T extends ShrinkablePhoto>(asset: T): Promise<T> {
  const target = resizeTarget(asset.width, asset.height);
  if (!target || !asset.uri) return asset;
  try {
    const out = await manipulateAsync(asset.uri, [{ resize: target }], { compress: 0.7, format: SaveFormat.JPEG, base64: true });
    if (!out.base64) return asset;
    return { ...asset, uri: out.uri, base64: out.base64, mimeType: "image/jpeg", width: out.width, height: out.height };
  } catch {
    return asset;
  }
}
