"use client";

import { useCallback, useRef, useState } from "react";
import { ImagePlus, Loader2, RotateCcw, Upload, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { UploadItem } from "@/hooks/use-image-upload";

type ImageDropzoneProps = {
  items: UploadItem[];
  onFiles: (files: FileList | File[]) => void;
  onRemove: (id: string) => void;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  disabled?: boolean;
  maxItems?: number;
  helperText?: string;
  className?: string;
};

const ACCEPT = "image/png,image/jpeg,image/webp,image/heic,image/heif";

export function ImageDropzone({
  items,
  onFiles,
  onRemove,
  onCancel,
  onRetry,
  disabled,
  maxItems = 4,
  helperText = "JPG, PNG or WEBP — up to 8MB each",
  className,
}: ImageDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFiles = useCallback(
    (files: FileList | File[] | null) => {
      if (!files) return;
      if (disabled) return;
      onFiles(files);
    },
    [disabled, onFiles],
  );

  const canAddMore = items.length < maxItems;

  return (
    <div className={cn("space-y-3", className)}>
      <label
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          if (e.dataTransfer?.files?.length) handleFiles(e.dataTransfer.files);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 py-6 text-center transition",
          isDragging
            ? "border-primary bg-primary/5"
            : "border-line bg-surface/60 hover:border-primary/40",
          (!canAddMore || disabled) && "pointer-events-none opacity-60",
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          disabled={!canAddMore || disabled}
          onChange={(e) => {
            handleFiles(e.target.files);
            if (e.target) e.target.value = "";
          }}
          className="sr-only"
        />
        <Upload size={22} className="text-primary" />
        <p className="text-sm font-bold text-content">
          Drag images here or <span className="text-primary underline">browse</span>
        </p>
        <p className="text-xs text-muted">
          {helperText} · Up to {maxItems} images
        </p>
      </label>

      {items.length > 0 ? (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {items.map((item) => (
            <li
              key={item.id}
              className="relative aspect-square overflow-hidden rounded-xl border border-line bg-surface"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.remoteUrl ?? item.previewUrl}
                alt={item.file.name}
                className="size-full object-cover"
              />
              <div className="absolute inset-0 flex flex-col justify-between bg-gradient-to-b from-transparent via-transparent to-black/60 p-1.5">
                <div className="flex justify-end">
                  {item.status === "uploading" || item.status === "compressing" ? (
                    <button
                      type="button"
                      onClick={() => onCancel(item.id)}
                      aria-label="Cancel upload"
                      className="grid size-6 place-items-center rounded-full bg-black/60 text-white"
                    >
                      <X size={12} />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onRemove(item.id)}
                      aria-label="Remove image"
                      className="grid size-6 place-items-center rounded-full bg-black/60 text-white"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
                <div className="text-[10px] font-semibold text-white">
                  {item.status === "compressing" ? (
                    <span className="flex items-center gap-1">
                      <Loader2 size={11} className="animate-spin" /> Compressing…
                    </span>
                  ) : item.status === "uploading" ? (
                    <div className="space-y-1">
                      <span className="flex items-center gap-1">
                        <Loader2 size={11} className="animate-spin" /> {item.progress}%
                      </span>
                      <span className="block h-1 overflow-hidden rounded-full bg-white/20">
                        <span
                          className="block h-full bg-primary transition-all"
                          style={{ width: `${item.progress}%` }}
                        />
                      </span>
                    </div>
                  ) : item.status === "error" || item.status === "cancelled" ? (
                    <button
                      type="button"
                      onClick={() => onRetry(item.id)}
                      className="flex items-center gap-1 rounded-md bg-error/90 px-2 py-1 text-white"
                    >
                      <RotateCcw size={11} /> Retry
                    </button>
                  ) : item.status === "success" ? (
                    <span className="rounded-md bg-emerald-500/90 px-2 py-0.5 text-white">
                      Uploaded
                    </span>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
          {canAddMore ? (
            <li>
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={disabled}
                className="flex aspect-square w-full items-center justify-center rounded-xl border-2 border-dashed border-line bg-surface text-muted transition hover:border-primary/40 hover:text-primary disabled:opacity-60"
              >
                <ImagePlus size={20} />
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
