"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { compressImage, type CompressOptions } from "@/lib/image-compress";
import { useAuthStore } from "@/stores/auth-store";
import { resolveApiBase } from "@/lib/api-base";

export type UploadStatus = "idle" | "queued" | "compressing" | "uploading" | "success" | "error" | "cancelled";

export type UploadItem = {
  id: string;
  file: File;
  previewUrl: string;
  status: UploadStatus;
  progress: number;
  remoteUrl?: string;
  error?: string;
  compressedSize?: number;
};

export type UseImageUploadOptions = {
  /** Endpoint that accepts a multipart upload and returns `{ url: string }` in `data`. */
  endpoint?: string;
  /** Field name in the FormData. Defaults to "file". */
  fieldName?: string;
  /** Max number of concurrent active items. Defaults to 4. */
  maxItems?: number;
  /** Max single-file size in bytes. Defaults to 8MB. */
  maxFileSize?: number;
  /** Compression options forwarded to image-compress. */
  compression?: CompressOptions;
  /** Allowed MIME prefixes. Defaults to ["image/"]. */
  accept?: string[];
};

const DEFAULTS = {
  endpoint: "/api/uploads",
  fieldName: "file",
  maxItems: 4,
  maxFileSize: 8 * 1024 * 1024,
  accept: ["image/"],
} as const;

function makeId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `up-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Manages a queue of image uploads with client-side compression and optimistic preview.
 * - Compresses before sending (via `lib/image-compress`).
 * - Tracks per-item progress via XHR.
 * - Supports per-item cancel and bulk reset.
 * - Returns final remote URLs once all queued items succeed (`getCompletedUrls`).
 */
export function useImageUpload(options: UseImageUploadOptions = {}) {
  const opts = { ...DEFAULTS, ...options };
  /** Always read the latest access token at request time (handles token refresh). */
  const tokenGetter = useRef<() => string | null>(() => useAuthStore.getState().accessToken ?? null);

  const [items, setItems] = useState<UploadItem[]>([]);
  const xhrsRef = useRef<Map<string, XMLHttpRequest>>(new Map());

  useEffect(() => {
    // Snapshot the mutable ref so the cleanup uses the same map that was active
    // when the effect ran (avoids react-hooks/exhaustive-deps warning).
    const xhrs = xhrsRef.current;
    return () => {
      for (const item of items) {
        if (item.previewUrl.startsWith("blob:")) URL.revokeObjectURL(item.previewUrl);
      }
      for (const xhr of xhrs.values()) xhr.abort();
      xhrs.clear();
    };
    // We only want to revoke previews when the hook unmounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = useCallback((id: string, patch: Partial<UploadItem>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }, []);

  const removeItem = useCallback((id: string) => {
    const xhr = xhrsRef.current.get(id);
    if (xhr) {
      xhr.abort();
      xhrsRef.current.delete(id);
    }
    setItems((prev) => {
      const target = prev.find((it) => it.id === id);
      if (target?.previewUrl.startsWith("blob:")) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((it) => it.id !== id);
    });
  }, []);

  const cancel = useCallback(
    (id: string) => {
      const xhr = xhrsRef.current.get(id);
      if (xhr) xhr.abort();
      xhrsRef.current.delete(id);
      update(id, { status: "cancelled", error: "Upload cancelled" });
    },
    [update],
  );

  const reset = useCallback(() => {
    for (const xhr of xhrsRef.current.values()) xhr.abort();
    xhrsRef.current.clear();
    setItems((prev) => {
      for (const it of prev) {
        if (it.previewUrl.startsWith("blob:")) URL.revokeObjectURL(it.previewUrl);
      }
      return [];
    });
  }, []);

  const sendOne = useCallback(
    async (item: UploadItem) => {
      update(item.id, { status: "compressing", progress: 5 });
      let blob: Blob = item.file;
      let compressedSize = item.file.size;
      try {
        const compressed = await compressImage(item.file, opts.compression);
        blob = compressed.blob;
        compressedSize = compressed.compressedSize;
      } catch {
        // Compression failure isn't fatal — fall back to original file.
      }

      update(item.id, { status: "uploading", progress: 10, compressedSize });

      const url = `${resolveApiBase()}${opts.endpoint}`;
      const formData = new FormData();
      formData.append(opts.fieldName, blob, item.file.name);

      const xhr = new XMLHttpRequest();
      xhrsRef.current.set(item.id, xhr);

      const result = await new Promise<{ ok: true; url: string } | { ok: false; error: string }>(
        (resolve) => {
          xhr.open("POST", url, true);
          const token = tokenGetter.current();
          if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);

          xhr.upload.onprogress = (e) => {
            if (!e.lengthComputable) return;
            const pct = Math.min(95, Math.max(10, Math.round((e.loaded / e.total) * 90) + 5));
            update(item.id, { progress: pct });
          };

          xhr.onerror = () => resolve({ ok: false, error: "Network error" });
          xhr.onabort = () => resolve({ ok: false, error: "Upload cancelled" });
          xhr.onload = () => {
            const status = xhr.status;
            if (status >= 200 && status < 300) {
              try {
                const json = JSON.parse(xhr.responseText) as {
                  success?: boolean;
                  data?: { url?: string; fileUrl?: string };
                  url?: string;
                  error?: string;
                };
                const remote =
                  json.data?.url ?? json.data?.fileUrl ?? json.url ?? null;
                if (remote) {
                  resolve({ ok: true, url: remote });
                  return;
                }
                resolve({ ok: false, error: json.error ?? "Upload response missing URL" });
              } catch {
                resolve({ ok: false, error: "Invalid upload response" });
              }
            } else {
              resolve({ ok: false, error: `Upload failed (${status})` });
            }
          };

          xhr.send(formData);
        },
      );

      xhrsRef.current.delete(item.id);
      if (result.ok) {
        update(item.id, { status: "success", progress: 100, remoteUrl: result.url });
      } else {
        update(item.id, {
          status: result.error === "Upload cancelled" ? "cancelled" : "error",
          error: result.error,
        });
      }
    },
    [opts.compression, opts.endpoint, opts.fieldName, update],
  );

  const enqueue = useCallback(
    (files: FileList | File[]) => {
      const incoming = Array.from(files);
      const accepted = incoming.filter((f) => {
        if (opts.accept.some((prefix) => f.type.startsWith(prefix))) return true;
        return false;
      });
      const valid = accepted.filter((f) => f.size <= opts.maxFileSize);

      const newItems: UploadItem[] = valid.slice(0, opts.maxItems).map((file) => ({
        id: makeId(),
        file,
        previewUrl: URL.createObjectURL(file),
        status: "queued",
        progress: 0,
      }));

      setItems((prev) => [...prev, ...newItems].slice(0, opts.maxItems));
      for (const item of newItems) void sendOne(item);

      const rejected: { file: File; reason: string }[] = [];
      for (const f of incoming) {
        if (!accepted.includes(f)) rejected.push({ file: f, reason: "Unsupported file type" });
        else if (!valid.includes(f)) rejected.push({ file: f, reason: "File too large" });
      }
      return { accepted: newItems, rejected };
    },
    [opts.accept, opts.maxFileSize, opts.maxItems, sendOne],
  );

  const retry = useCallback(
    (id: string) => {
      const item = items.find((it) => it.id === id);
      if (!item) return;
      update(id, { status: "queued", progress: 0, error: undefined });
      void sendOne(item);
    },
    [items, sendOne, update],
  );

  const getCompletedUrls = useCallback(
    () =>
      items
        .filter((it) => it.status === "success" && it.remoteUrl)
        .map((it) => it.remoteUrl as string),
    [items],
  );

  const isUploading = items.some(
    (it) => it.status === "queued" || it.status === "compressing" || it.status === "uploading",
  );

  return {
    items,
    enqueue,
    cancel,
    retry,
    removeItem,
    reset,
    getCompletedUrls,
    isUploading,
  };
}
