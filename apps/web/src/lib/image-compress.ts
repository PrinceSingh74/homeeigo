/**
 * Client-side image compression using <canvas>. Preserves the original orientation
 * via createImageBitmap which respects EXIF on modern browsers. Targets a max
 * dimension and JPEG/WEBP quality; returns the smaller of compressed vs original.
 */

export type CompressOptions = {
  /** Maximum width or height in pixels. Defaults to 1600. */
  maxDimension?: number;
  /** JPEG/WEBP quality 0..1. Defaults to 0.82. */
  quality?: number;
  /** Output MIME — "image/webp" preferred on modern browsers. */
  mimeType?: "image/jpeg" | "image/webp";
};

export type CompressedImage = {
  blob: Blob;
  width: number;
  height: number;
  mimeType: string;
  originalSize: number;
  compressedSize: number;
};

const DEFAULT_OPTIONS: Required<CompressOptions> = {
  maxDimension: 1600,
  quality: 0.82,
  mimeType: "image/webp",
};

function isImageType(file: File): boolean {
  return file.type.startsWith("image/");
}

function fileSupportsCanvas(file: File): boolean {
  // SVG and HEIC/HEIF cannot be safely drawn to canvas across browsers.
  if (file.type.includes("svg")) return false;
  if (/heic|heif/i.test(file.type)) return false;
  return isImageType(file);
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      /* fall through */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Failed to load image"));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function dimensionsOf(source: ImageBitmap | HTMLImageElement): { width: number; height: number } {
  return {
    width: "width" in source ? source.width : 0,
    height: "height" in source ? source.height : 0,
  };
}

function pickOutputMime(mimeType: CompressOptions["mimeType"]): string {
  if (typeof document === "undefined") return mimeType ?? "image/jpeg";
  const canvas = document.createElement("canvas");
  if (mimeType === "image/webp" && canvas.toDataURL("image/webp").startsWith("data:image/webp")) {
    return "image/webp";
  }
  return "image/jpeg";
}

export async function compressImage(
  file: File,
  options: CompressOptions = {},
): Promise<CompressedImage> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  if (!fileSupportsCanvas(file)) {
    return {
      blob: file,
      width: 0,
      height: 0,
      mimeType: file.type || "application/octet-stream",
      originalSize: file.size,
      compressedSize: file.size,
    };
  }

  const bitmap = await loadBitmap(file);
  const { width, height } = dimensionsOf(bitmap);
  if (!width || !height) {
    return {
      blob: file,
      width,
      height,
      mimeType: file.type,
      originalSize: file.size,
      compressedSize: file.size,
    };
  }

  const ratio = Math.min(opts.maxDimension / width, opts.maxDimension / height, 1);
  const targetWidth = Math.max(1, Math.round(width * ratio));
  const targetHeight = Math.max(1, Math.round(height * ratio));

  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return {
      blob: file,
      width,
      height,
      mimeType: file.type,
      originalSize: file.size,
      compressedSize: file.size,
    };
  }

  ctx.drawImage(bitmap as CanvasImageSource, 0, 0, targetWidth, targetHeight);
  if ("close" in bitmap && typeof bitmap.close === "function") bitmap.close();

  const mime = pickOutputMime(opts.mimeType);
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b), mime, opts.quality);
  });

  if (!blob) {
    return {
      blob: file,
      width: targetWidth,
      height: targetHeight,
      mimeType: file.type,
      originalSize: file.size,
      compressedSize: file.size,
    };
  }

  if (blob.size >= file.size) {
    return {
      blob: file,
      width,
      height,
      mimeType: file.type,
      originalSize: file.size,
      compressedSize: file.size,
    };
  }

  return {
    blob,
    width: targetWidth,
    height: targetHeight,
    mimeType: mime,
    originalSize: file.size,
    compressedSize: blob.size,
  };
}
