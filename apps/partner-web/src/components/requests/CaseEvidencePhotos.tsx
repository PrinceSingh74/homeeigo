"use client";

import { useEffect, useState } from "react";
import { ImageOff, Loader2 } from "lucide-react";
import { apiRequestRaw } from "@/lib/api-client";
import type { PartnerCaseEvidence } from "@/types/partner";

/**
 * Phase 10 §11 — the photos a customer attached to a reported issue.
 *
 * A stored photo is private: `GET /api/bookings/:id/cases/:caseId/evidence/:evidenceId/media`
 * answers only to the assigned partner's own token, so it cannot be an `<img src>`. Each one is
 * fetched with the authenticated client, shown from an object URL, and the URL is revoked when the
 * thumbnail unmounts. Only items the server marks `hasStoredMedia` are requested.
 */

type Photo = { state: "loading" } | { state: "ready"; url: string } | { state: "unavailable" };

function useCaseEvidencePhoto(path: string): Photo {
  const [photo, setPhoto] = useState<Photo>({ state: "loading" });
  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    setPhoto({ state: "loading" });
    void (async () => {
      try {
        const res = await apiRequestRaw(path);
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        // A refusal can still be a 200 JSON envelope; only an image is shown as one.
        if (!blob.type.startsWith("image/") || blob.size === 0) throw new Error("not an image");
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setPhoto({ state: "ready", url });
      } catch {
        if (!cancelled) setPhoto({ state: "unavailable" });
      }
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [path]);
  return photo;
}

const frame = "flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-partner-line bg-partner-bg/60";

function CaseEvidencePhoto({ path, alt }: { path: string; alt: string }) {
  const photo = useCaseEvidencePhoto(path);
  if (photo.state === "loading") {
    return (
      <div className={frame} role="status" aria-label={`Loading: ${alt}`} data-testid="case-photo" data-state="loading">
        <Loader2 className="h-5 w-5 animate-spin text-partner-muted" aria-hidden="true" />
      </div>
    );
  }
  if (photo.state === "unavailable") {
    return (
      <div className={`${frame} flex-col gap-1 px-1 text-center text-[11px] font-medium text-partner-muted`} data-testid="case-photo" data-state="unavailable">
        <ImageOff className="h-4 w-4" aria-hidden="true" />
        Photo unavailable
      </div>
    );
  }
  return (
    <a
      href={photo.url}
      target="_blank"
      rel="noreferrer"
      className={`${frame} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-partner-primary`}
      data-testid="case-photo"
      data-state="ready"
    >
      {/* An object URL of a private blob: next/image cannot optimise or even fetch it. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={photo.url} alt={alt} className="h-full w-full object-cover" />
    </a>
  );
}

export function CaseEvidencePhotos({
  bookingId,
  caseId,
  caseNumber,
  evidence,
}: {
  bookingId: string;
  caseId: string;
  caseNumber: string;
  evidence: readonly PartnerCaseEvidence[];
}) {
  const photos = evidence.filter((e) => e.hasStoredMedia === true);
  if (photos.length === 0) return null;
  const base = `/api/bookings/${encodeURIComponent(bookingId)}/cases/${encodeURIComponent(caseId)}/evidence`;
  return (
    <div className="mt-2 space-y-1" data-testid="case-photos">
      <p className="font-semibold text-partner-text">
        Customer photo{photos.length === 1 ? "" : "s"} <span className="font-normal text-partner-muted">· {photos.length}</span>
      </p>
      <ul className="flex flex-wrap gap-2">
        {photos.map((e, i) => (
          <li key={e.id}>
            <CaseEvidencePhoto
              path={`${base}/${e.id}/media`}
              alt={`Photo ${i + 1} of ${photos.length} the customer attached to issue ${caseNumber}${e.note ? `: ${e.note}` : ""}`}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
