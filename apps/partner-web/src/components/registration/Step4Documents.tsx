"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, FileUp } from "lucide-react";
import { PartnerButton } from "@/components/ui/PartnerButton";
import { partnerRegistrationApi } from "@/services/partner-registration-api";
import { getErrorMessage } from "@/lib/api-error";

export const ONBOARDING_DOC_TYPES = [
  { id: "pan", label: "PAN certificate", hint: "Clear photo or PDF of your PAN card" },
  { id: "aadhar", label: "Aadhaar card", hint: "Front side is enough — we never show the number to HQ unnecessarily" },
  { id: "bank_cheque", label: "Cancelled cheque / passbook", hint: "Used to verify payout account name" },
] as const;

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Document could not be read. Try PDF, JPG or PNG."));
    reader.readAsDataURL(file);
  });
}

export function Step4Documents({
  onContinue,
  loading,
}: {
  onContinue: (uploadedTypes: string[]) => Promise<void>;
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const docs = await partnerRegistrationApi.listDocuments();
        if (cancelled) return;
        setUploaded(new Set(docs.map((d) => d.documentType)));
      } catch {
        /* listing is optional on first visit */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleUpload(type: string) {
    const file = files[type];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setMessage("Document is too large. Maximum size is 5MB.");
      return;
    }
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
      setMessage(`${type.replace(/_/g, " ")} uploaded`);
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
        await onContinue([...uploaded]);
      }}
      className="space-y-5"
    >
      <div>
        <h2 className="text-xl font-semibold">Documents</h2>
        <p className="mt-1 text-sm text-partner-muted">
          Upload PDF, JPG or PNG. You can skip and add files later — HQ will still review your file.
        </p>
        <p className="mt-2 text-xs font-semibold text-partner-primary">
          {uploaded.size} of {ONBOARDING_DOC_TYPES.length} uploaded
        </p>
      </div>

      {ONBOARDING_DOC_TYPES.map(({ id, label, hint }) => (
        <div key={id} className="rounded-2xl border border-partner-line bg-white/70 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">{label}</p>
              <p className="mt-0.5 text-xs text-partner-muted">{hint}</p>
            </div>
            {uploaded.has(id) ? (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600">
                <CheckCircle2 className="h-3.5 w-3.5" /> Uploaded
              </span>
            ) : null}
          </div>
          <div className="mt-3 space-y-2">
            <input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp"
              aria-label={uploaded.has(id) ? `Replace ${label}` : `Upload ${label}`}
              onChange={(e) => setFiles((prev) => ({ ...prev, [id]: e.target.files?.[0] ?? null }))}
              className="w-full text-sm text-partner-muted file:mr-3 file:rounded-lg file:border-0 file:bg-partner-primary/10 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-partner-primary"
            />
            {uploaded.has(id) && !files[id] ? (
              <p className="text-xs text-partner-muted">Choose a file to replace this upload.</p>
            ) : null}
            {files[id] ? (
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-xs text-partner-muted">{files[id]?.name}</p>
                <PartnerButton
                  type="button"
                  variant="outline"
                  disabled={uploading === id}
                  onClick={() => void handleUpload(id)}
                >
                  <FileUp className="h-4 w-4" />
                  {uploading === id ? "Uploading…" : uploaded.has(id) ? "Replace" : "Upload"}
                </PartnerButton>
              </div>
            ) : null}
          </div>
        </div>
      ))}

      {message ? <p className="text-sm text-partner-muted">{message}</p> : null}

      <PartnerButton type="submit" className="w-full" disabled={loading || Boolean(uploading)}>
        {loading ? "Saving…" : "Save & continue to assessment"}
      </PartnerButton>
    </form>
  );
}
