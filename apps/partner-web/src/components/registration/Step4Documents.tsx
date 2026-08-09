"use client";

import { useState } from "react";
import { PartnerButton } from "@/components/ui/PartnerButton";
import { partnerRegistrationApi } from "@/services/partner-registration-api";
import { getErrorMessage } from "@/lib/api-error";

const DOC_TYPES = [
  { id: "pan", label: "PAN certificate" },
  { id: "aadhar", label: "Aadhar card" },
  { id: "bank_cheque", label: "Bank cheque / passbook" },
] as const;

export function Step4Documents({
  onSubmit,
  loading,
}: {
  onSubmit: () => Promise<void>;
  loading: boolean;
}) {
  const [files, setFiles] = useState<Record<string, File | null>>({
    pan: null,
    aadhar: null,
    bank_cheque: null,
  });
  const [uploading, setUploading] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);

  function handleFileChange(type: string, file: File | null) {
    setFiles((prev) => ({ ...prev, [type]: file }));
  }

  async function handleUpload(type: string) {
    const file = files[type];
    if (!file) return;
    setUploading(type);
    setMessage(null);
    try {
      const base64 = await readFileAsDataUrl(file);
      await partnerRegistrationApi.uploadDocument({
        file: base64,
        documentType: type,
        fileName: file.name,
      });
      setUploaded((prev) => new Set(prev).add(type));
      setFiles((prev) => ({ ...prev, [type]: null }));
      setMessage(`${type} uploaded`);
    } catch (err) {
      setMessage(getErrorMessage(err));
    } finally {
      setUploading(null);
    }
  }

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        await onSubmit();
      }}
      className="space-y-5"
    >
      <h2 className="text-xl font-semibold">Documents</h2>
      <p className="text-sm text-[var(--color-partner-muted)]">
        Upload now or skip — admin will review your application either way.
      </p>

      {DOC_TYPES.map(({ id, label }) => (
        <div
          key={id}
          className="rounded-lg border border-[var(--color-partner-border)] p-4"
        >
          <label className="mb-2 block text-sm font-medium">{label}</label>
          <input
            type="file"
            accept=".pdf,.jpg,.jpeg,.png"
            onChange={(e) => handleFileChange(id, e.target.files?.[0] ?? null)}
            className="mb-2 w-full text-sm text-[var(--color-partner-muted)]"
          />
          {uploaded.has(id) ? (
            <p className="text-xs text-emerald-400">Uploaded</p>
          ) : files[id] ? (
            <PartnerButton
              type="button"
              variant="outline"
              disabled={uploading === id}
              onClick={() => void handleUpload(id)}
            >
              {uploading === id ? "Uploading…" : `Upload ${label}`}
            </PartnerButton>
          ) : null}
        </div>
      ))}

      {message ? <p className="text-sm text-[var(--color-partner-muted)]">{message}</p> : null}

      <PartnerButton type="submit" className="w-full" disabled={loading}>
        {loading ? "Submitting…" : "Submit application"}
      </PartnerButton>
    </form>
  );
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}
