"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, BadgeCheck, FileText, Loader2, Pencil, Wrench } from "lucide-react";
import { getErrorMessage } from "@/lib/api-error";
import { PartnerCard } from "@/components/ui/PartnerCard";
import { PartnerButton } from "@/components/ui/PartnerButton";
import { usePartnerMeQuery, useUpdateProfileMutation } from "@/hooks/use-partner-data";
import { formatInr, formatNumber } from "@/lib/format";

function kycLabel(status: string): {
  label: string;
  className: string;
} {
  const s = status.toLowerCase();
  if (s.includes("verified") || s === "approved") {
    return { label: "Verified", className: "text-partner-success" };
  }
  if (s.includes("pending") || s.includes("review") || s === "not_started") {
    return { label: "Pending", className: "text-partner-warning" };
  }
  if (s.includes("reject")) {
    return { label: "Rejected", className: "text-partner-danger" };
  }
  return { label: status || "Unknown", className: "text-partner-muted" };
}

export function ProfileSections() {
  const { data: provider, isLoading, isError, error, refetch, isFetching } =
    usePartnerMeQuery();
  const updateProfile = useUpdateProfileMutation();
  const [editing, setEditing] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [bio, setBio] = useState("");

  useEffect(() => {
    if (!provider) return;
    setFirstName(provider.firstName ?? "");
    setLastName(provider.lastName ?? "");
    setBio(provider.bio ?? "");
  }, [provider]);

  async function saveProfile() {
    await updateProfile.mutateAsync({
      firstName: firstName.trim() || undefined,
      lastName: lastName.trim() || undefined,
      bio: bio.trim() || undefined,
    });
    setEditing(false);
  }

  if (isLoading && !provider) {
    return (
      <div className="flex items-center gap-2 text-sm text-partner-muted">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading your profile…
      </div>
    );
  }

  if (isError && !provider) {
    return (
      <div className="rounded-xl border border-partner-danger/30 bg-partner-danger/10 p-4 text-sm">
        <p className="flex items-start gap-2 text-partner-danger">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{getErrorMessage(error, "Could not load profile.")}</span>
        </p>
        <button
          type="button"
          onClick={() => void refetch()}
          disabled={isFetching}
          className="mt-3 font-semibold text-partner-primary underline"
        >
          {isFetching ? "Retrying…" : "Retry"}
        </button>
      </div>
    );
  }

  if (!provider) {
    return (
      <p className="text-sm text-partner-muted">No provider profile found for this account.</p>
    );
  }

  const kyc = kycLabel(provider.kycStatus);
  const initials = (provider.firstName || provider.name).charAt(0).toUpperCase();

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        {!editing ? (
          <PartnerButton variant="outline" onClick={() => setEditing(true)}>
            <Pencil className="h-4 w-4" /> Edit profile
          </PartnerButton>
        ) : (
          <div className="flex gap-2">
            <PartnerButton
              variant="outline"
              disabled={updateProfile.isPending}
              onClick={() => {
                setEditing(false);
                if (provider) {
                  setFirstName(provider.firstName ?? "");
                  setLastName(provider.lastName ?? "");
                  setBio(provider.bio ?? "");
                }
              }}
            >
              Cancel
            </PartnerButton>
            <PartnerButton disabled={updateProfile.isPending} onClick={() => void saveProfile()}>
              {updateProfile.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              Save
            </PartnerButton>
          </div>
        )}
      </div>

      <PartnerCard className="flex items-center gap-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-partner-primary/20 font-display text-2xl font-bold">
          {initials}
        </div>
        <div>
          <p className="font-display text-xl font-bold">{provider.name}</p>
          <p className="text-sm text-partner-muted">
            {provider.phoneNumber ?? provider.email}
          </p>
          <p className={`mt-1 flex items-center gap-1 text-sm ${kyc.className}`}>
            <BadgeCheck className="h-4 w-4" />
            KYC {kyc.label}
            {provider.isApproved ? " · Approved" : " · Awaiting approval"}
          </p>
        </div>
      </PartnerCard>

      <div className="grid gap-3 sm:grid-cols-3">
        <Mini label="Rating" value={provider.rating > 0 ? provider.rating.toFixed(2) : "—"} />
        <Mini label="Jobs done" value={formatNumber(provider.completedBookings)} />
        <Mini label="Earnings" value={formatInr(provider.totalEarnings, true)} />
      </div>

      <PartnerCard>
        <p className="text-sm font-semibold">Business information</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Business name" value={provider.businessName ?? provider.name} readOnly />
          <Field label="Email" value={provider.email} readOnly />
          <Field label="Phone" value={provider.phoneNumber ?? "—"} readOnly />
          <Field label="City" value={provider.city ?? "—"} readOnly />
          {editing ? (
            <>
              <EditableField label="First name" value={firstName} onChange={setFirstName} />
              <EditableField label="Last name" value={lastName} onChange={setLastName} />
            </>
          ) : (
            <>
              <Field label="First name" value={provider.firstName ?? "—"} readOnly />
              <Field label="Last name" value={provider.lastName ?? "—"} readOnly />
            </>
          )}
        </div>
        <div className="mt-4">
          {editing ? (
            <EditableField label="Bio" value={bio} onChange={setBio} multiline />
          ) : (
            <Field label="Bio" value={provider.bio?.trim() || "—"} readOnly />
          )}
        </div>
      </PartnerCard>

      {(provider.workingDays.length > 0 ||
        provider.workingHoursStart ||
        provider.workingHoursEnd) && (
        <PartnerCard>
          <p className="text-sm font-semibold">Availability</p>
          <ul className="mt-3 space-y-2 text-sm">
            {provider.workingDays.length > 0 ? (
              provider.workingDays.map((day) => (
                <li
                  key={day}
                  className="flex items-center justify-between rounded-lg bg-partner-bg/40 px-3 py-2"
                >
                  <span className="font-medium capitalize">{day}</span>
                  <span className="text-partner-muted">
                    {provider.workingHoursStart ?? "—"} – {provider.workingHoursEnd ?? "—"}
                  </span>
                </li>
              ))
            ) : (
              <li className="text-partner-muted">
                {provider.workingHoursStart ?? "—"} – {provider.workingHoursEnd ?? "—"}
              </li>
            )}
          </ul>
        </PartnerCard>
      )}

      <PartnerCard>
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Wrench className="h-4 w-4 text-partner-primary" />
          Service categories
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {provider.services.length > 0 ? (
            provider.services.map((s) => (
              <span
                key={s.id}
                className="rounded-full border border-partner-line px-3 py-1 text-xs"
              >
                {s.name}
              </span>
            ))
          ) : (
            <p className="text-xs text-partner-muted">
              No services configured yet.
            </p>
          )}
        </div>
      </PartnerCard>

      <PartnerCard>
        <p className="flex items-center gap-2 text-sm font-semibold">
          <FileText className="h-4 w-4 text-partner-primary" />
          Verification
        </p>
        <ul className="mt-3 space-y-2 text-sm">
          <li className="flex justify-between">
            <span className="text-partner-muted">Email verified</span>
            <span className={provider.email ? "text-partner-success" : "text-partner-muted"}>
              {provider.email ? "Yes" : "—"}
            </span>
          </li>
          <li className="flex justify-between">
            <span className="text-partner-muted">Phone verified</span>
            <span className={provider.phoneNumber ? "text-partner-success" : "text-partner-muted"}>
              {provider.phoneNumber ? "Yes" : "—"}
            </span>
          </li>
          <li className="flex justify-between">
            <span className="text-partner-muted">Background check</span>
            <span className={kyc.className}>{kyc.label}</span>
          </li>
          <li className="flex justify-between">
            <span className="text-partner-muted">Online status</span>
            <span
              className={provider.isOnline ? "text-partner-success" : "text-partner-muted"}
            >
              {provider.isOnline ? "Available" : "Offline"}
            </span>
          </li>
        </ul>
      </PartnerCard>

      <div className="grid gap-2 sm:grid-cols-2">
        <Link
          href="/analytics"
          className="partner-card partner-card-hover rounded-2xl px-4 py-3 text-center text-sm font-medium"
        >
          Performance analytics
        </Link>
        <Link
          href="/reviews"
          className="partner-card partner-card-hover rounded-2xl px-4 py-3 text-center text-sm font-medium"
        >
          Customer reviews
        </Link>
        <Link
          href="/availability"
          className="partner-card partner-card-hover rounded-2xl px-4 py-3 text-center text-sm font-medium sm:col-span-2"
        >
          Availability settings
        </Link>
      </div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <PartnerCard>
      <p className="text-xs text-partner-muted">{label}</p>
      <p className="font-display mt-1 text-xl font-bold">{value}</p>
    </PartnerCard>
  );
}

function Field({
  label,
  value,
  readOnly,
}: {
  label: string;
  value: string;
  readOnly?: boolean;
}) {
  return (
    <div>
      <p className="text-xs text-partner-muted">{label}</p>
      <p className={readOnly ? "mt-1 text-sm text-partner-text" : "mt-1 text-sm"}>{value}</p>
    </div>
  );
}

function EditableField({
  label,
  value,
  onChange,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
}) {
  return (
    <div>
      <label className="text-xs text-partner-muted">{label}</label>
      {multiline ? (
        <textarea
          rows={3}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="mt-1 w-full rounded-xl border border-partner-line bg-partner-bg/60 px-3 py-2 text-sm outline-none focus:border-partner-primary"
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="mt-1 w-full rounded-xl border border-partner-line bg-partner-bg/60 px-3 py-2 text-sm outline-none focus:border-partner-primary"
        />
      )}
    </div>
  );
}
