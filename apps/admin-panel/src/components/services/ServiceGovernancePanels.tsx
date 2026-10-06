"use client";

import { useState } from "react";
import { getErrorMessage } from "@/lib/api-error";
import {
  useServiceAuditQuery,
  useServiceCategoryMutation,
  useServiceRestoreMutation,
  useServiceTaxonomyQuery,
  useServiceVersionDiffQuery,
} from "@/hooks/use-admin-data";
import type { ActorNames, PublishGateView, ServiceVersionRow } from "@/services/admin-api";

const FIELD_LABELS: Record<string, string> = {
  basePrice: "Base price",
  minPrice: "Minimum price",
  maxPrice: "Maximum price",
  estimatedDuration: "Duration (min)",
  pricingModel: "Pricing model",
  description: "Description",
  detailedDescription: "Detailed description",
  includedServices: "Included",
  excludedServices: "Not included",
  availableCities: "Cities",
};

export function changeLabel(field: string) {
  if (field.startsWith("config.")) return `Configuration · ${field.slice(7)}`;
  return FIELD_LABELS[field] ?? field;
}

export function changeValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 140 ? `${text.slice(0, 140)}…` : text;
}

/** Before / after for a list of changed fields. Shared by pending revisions and version history. */
export function ChangeTable({ changes, beforeLabel, afterLabel }: { changes: { field: string; before: unknown; after: unknown }[]; beforeLabel: string; afterLabel: string }) {
  if (!changes.length) return <p className="mt-2 text-[var(--color-biz-muted)]">No difference in price, duration, content or configuration.</p>;
  return (
    <table className="mt-2 w-full text-left">
      <thead>
        <tr className="text-[var(--color-biz-muted)]">
          <th scope="col" className="pr-2 font-medium">Field</th>
          <th scope="col" className="pr-2 font-medium">{beforeLabel}</th>
          <th scope="col" className="font-medium">{afterLabel}</th>
        </tr>
      </thead>
      <tbody>
        {changes.map((c) => (
          <tr key={c.field} className="align-top">
            <th scope="row" className="pr-2 font-medium">{changeLabel(c.field)}</th>
            <td className="break-all pr-2">{changeValue(c.before)}</td>
            <td className="break-all">{changeValue(c.after)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The eighteen gates of the publish rule, in the order the rule lists them (mirror of backend PUBLISH_GATES). */
const PUBLISH_GATES: [string, string][] = [
  ["PRICING", "Pricing"],
  ["VARIANT", "Variant"],
  ["ADDON_COMPATIBILITY", "Add-on compatibility"],
  ["DURATION", "Duration"],
  ["ELIGIBILITY", "Eligibility"],
  ["SERVICEABILITY", "Serviceability"],
  ["AVAILABILITY", "Availability"],
  ["MATERIALS", "Materials"],
  ["EQUIPMENT", "Equipment"],
  ["PROVIDER_REQUIREMENTS", "Provider requirements"],
  ["MATCHING", "Matching"],
  ["BOOKING_POLICY", "Booking policy"],
  ["CANCELLATION", "Cancellation"],
  ["REFUND", "Refund"],
  ["SAFETY", "Safety"],
  ["QUALITY", "Quality"],
  ["CUSTOMER_CONTENT", "Customer content"],
  ["PARTNER_EXECUTION_BRIEF", "Partner execution brief"],
];
const STATUS_ORDER = ["FAIL", "BLOCKED", "WARNING", "PASS", "NOT_APPLICABLE"];
const STATUS_LABEL: Record<string, string> = { FAIL: "Fail", BLOCKED: "Blocked", WARNING: "Warning", PASS: "Pass", NOT_APPLICABLE: "Not applicable" };

/**
 * One row per publish gate with its worst status, so an admin sees all eighteen at once: what
 * passed, what warns, what blocks. A critical Fail or Blocked is what stops a publish.
 */
export function PublishGateTable({ gates }: { gates: PublishGateView[] }) {
  if (!gates.some((g) => g.gate)) return null;
  return (
    <details className="text-xs" data-testid="publish-gates">
      <summary className="cursor-pointer">All 18 publish gates</summary>
      <table className="mt-1 w-full text-left">
        <thead>
          <tr className="text-[var(--color-biz-muted)]">
            <th scope="col" className="pr-2 font-medium">Gate</th>
            <th scope="col" className="pr-2 font-medium">Status</th>
            <th scope="col" className="font-medium">Finding</th>
          </tr>
        </thead>
        <tbody>
          {PUBLISH_GATES.map(([key, label]) => {
            const mine = gates.filter((g) => g.gate === key).sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));
            const worst = mine[0];
            const blocks = worst && worst.severity === "critical" && (worst.status === "FAIL" || worst.status === "BLOCKED");
            return (
              <tr key={key} className="align-top" data-gate={key} data-status={worst?.status ?? "MISSING"}>
                <th scope="row" className="pr-2 font-medium">{label}</th>
                <td className={`pr-2 ${blocks ? "font-semibold text-[var(--color-biz-warning)]" : ""}`}>
                  {worst ? STATUS_LABEL[worst.status] : "Not reported"}
                  {blocks ? " · blocks publish" : ""}
                </td>
                <td className="text-[var(--color-biz-muted)]">
                  {worst?.message ?? ""}
                  {worst && worst.status !== "PASS" && worst.status !== "NOT_APPLICABLE" && worst.remediation ? ` ${worst.remediation}` : ""}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </details>
  );
}

/** Published versions, each comparable with the one before it. */
export function VersionHistory({ serviceId, versions, actors }: { serviceId: string; versions: ServiceVersionRow[]; actors?: ActorNames }) {
  const [open, setOpen] = useState<number | null>(null);
  const previous = open != null ? versions.find((v) => v.version < open)?.version ?? null : null;
  const diff = useServiceVersionDiffQuery(serviceId, previous, open);
  const restore = useServiceRestoreMutation();
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const current = versions[0]?.version ?? null;
  const restoreVersion = (version: number) => {
    const reason = window.prompt(`Reason for restoring version ${version} (recorded in the audit trail). It is published as a new version; nothing is deleted.`);
    if (reason === null) return;
    if (!reason.trim()) {
      setMessage({ kind: "error", text: "A reason is required to restore a version." });
      return;
    }
    setMessage(null);
    restore
      .mutateAsync({ id: serviceId, version, reason: reason.trim() })
      .then((r) => setMessage({ kind: "ok", text: r?.pendingRevision ? `Version ${version} is proposed as a pending revision and waits for a different admin.` : `Version ${version} restored as a new version.` }))
      .catch((e) => setMessage({ kind: "error", text: getErrorMessage(e) }));
  };
  if (!versions.length) return null;
  return (
    <details className="mt-2 text-xs" data-testid="version-history">
      <summary className="cursor-pointer">Published versions ({versions.length})</summary>
      {message ? (
        <p className={`mt-1 ${message.kind === "error" ? "text-[var(--color-biz-warning)]" : ""}`} role={message.kind === "error" ? "alert" : "status"}>
          {message.text}
        </p>
      ) : null}
      <ul className="mt-1 space-y-1">
        {versions.slice(0, 20).map((v, i) => {
          const hasPrevious = i < versions.length - 1;
          return (
            <li key={v.version}>
              <span className="font-mono">
                v{v.version} · {new Date(v.publishedAt ?? v.createdAt).toLocaleString()}
                {v.createdBy ? ` · ${actors?.[v.createdBy] ?? v.createdBy}` : ""}
              </span>
              {hasPrevious ? (
                <button
                  type="button"
                  className="biz-btn ml-2 text-xs"
                  aria-expanded={open === v.version}
                  onClick={() => setOpen(open === v.version ? null : v.version)}
                >
                  {open === v.version ? "Hide changes" : "What changed"}
                </button>
              ) : (
                <span className="ml-2 text-[var(--color-biz-muted)]">first published version</span>
              )}
              {v.version !== current ? (
                <button type="button" className="biz-btn ml-2 text-xs" disabled={restore.isPending} onClick={() => restoreVersion(v.version)} aria-label={`Restore version ${v.version}`}>
                  Restore
                </button>
              ) : (
                <span className="ml-2 text-[var(--color-biz-muted)]">current</span>
              )}
              {open === v.version ? (
                diff.isLoading ? (
                  <p className="mt-1 text-[var(--color-biz-muted)]">Loading…</p>
                ) : diff.isError ? (
                  <p className="mt-1 text-[var(--color-biz-warning)]" role="alert">{getErrorMessage(diff.error)}</p>
                ) : diff.data ? (
                  <ChangeTable changes={diff.data.changes} beforeLabel={`v${diff.data.from.version}`} afterLabel={`v${diff.data.to.version}`} />
                ) : null
              ) : null}
            </li>
          );
        })}
      </ul>
    </details>
  );
}

const ACTION_LABELS: Record<string, string> = {
  SERVICE_APPROVED: "Approved for publish",
  SERVICE_LIFECYCLE_CHANGED: "Lifecycle changed",
  SERVICE_CONFIG_VERSIONED: "New version published",
  SERVICE_PUBLISHED: "Published",
  SERVICE_REVISION_PROPOSED: "Revision proposed",
  SERVICE_REVISION_APPROVED: "Revision approved",
  SERVICE_REVISION_REJECTED: "Revision discarded",
  SERVICE_SCHEDULED_ACTIVATION_FAILED: "Scheduled go-live failed",
};

/** Who did what to this service. Fetched when opened; an admin without audit access sees the refusal. */
export function ServiceAuditTrail({ serviceId }: { serviceId: string }) {
  const [open, setOpen] = useState(false);
  const audit = useServiceAuditQuery(serviceId, open);
  return (
    <details className="mt-2" data-testid="service-audit" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer">Audit trail</summary>
      {audit.isLoading ? (
        <p className="mt-1 text-[var(--color-biz-muted)]">Loading…</p>
      ) : audit.isError ? (
        <p className="mt-1 text-[var(--color-biz-warning)]" role="alert">{getErrorMessage(audit.error)}</p>
      ) : !audit.data?.entries.length ? (
        <p className="mt-1 text-[var(--color-biz-muted)]">No recorded changes for this service.</p>
      ) : (
        <ol className="mt-1 space-y-1.5">
          {audit.data.entries.map((e) => (
            <li key={e.id}>
              <span className="font-medium">{ACTION_LABELS[e.action] ?? e.action}</span>
              {e.from && e.to ? ` (${e.from} → ${e.to})` : ""}
              {e.version != null ? ` · v${e.version}` : ""}
              {e.status && e.status !== "success" ? ` · ${e.status}` : ""}
              <span className="block text-[var(--color-biz-muted)]">
                {new Date(e.at).toLocaleString()} · by {e.actorId ? (audit.data?.actors?.[e.actorId] ?? e.actorId) : "unknown"}
                {e.approvedBy ? ` · approved by ${audit.data?.actors?.[e.approvedBy] ?? e.approvedBy}` : ""}
                {e.changes.length ? ` · changed: ${e.changes.map(changeLabel).join(", ")}` : ""}
                {e.reason ? ` · reason: ${e.reason}` : ""}
              </span>
            </li>
          ))}
        </ol>
      )}
    </details>
  );
}

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** The customer category tree: add, rename, reorder, switch on or off. Slugs are fixed once created. */
export function CategoryManager() {
  const taxonomy = useServiceTaxonomyQuery();
  const mutate = useServiceCategoryMutation();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [parentId, setParentId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const categories = taxonomy.data?.categories ?? [];

  const run = (vars: Parameters<typeof mutate.mutateAsync>[0]) => {
    setError(null);
    return mutate.mutateAsync(vars).catch((e) => setError(getErrorMessage(e)));
  };

  const rename = (id: string, current: string) => {
    const next = window.prompt("Category name", current);
    if (next === null || !next.trim() || next.trim() === current) return;
    void run({ kind: "update", id, body: { name: next.trim() } });
  };
  const reorder = (id: string, current: number) => {
    const next = window.prompt("Sort order (lower shows first)", String(current));
    if (next === null) return;
    const n = Number(next);
    if (!Number.isInteger(n) || n < 0) {
      setError("Sort order must be a whole number, 0 or more.");
      return;
    }
    void run({ kind: "update", id, body: { sortOrder: n } });
  };

  const row = (c: { id: string; slug: string; name: string; sortOrder: number; isActive: boolean; serviceCount: number }, child: boolean) => (
    <li key={c.id} className={child ? "ml-5" : ""}>
      <span className={c.isActive ? "font-medium" : "font-medium text-[var(--color-biz-muted)] line-through"}>{c.name}</span>
      <span className="text-[var(--color-biz-muted)]">
        {" "}
        · /{c.slug} · order {c.sortOrder} · {c.serviceCount} service{c.serviceCount === 1 ? "" : "s"}
        {c.isActive ? "" : " · off"}
      </span>
      <span className="ml-2 inline-flex flex-wrap gap-1">
        <button type="button" className="biz-btn text-xs" disabled={mutate.isPending} onClick={() => rename(c.id, c.name)} aria-label={`Rename ${c.name}`}>
          Rename
        </button>
        <button type="button" className="biz-btn text-xs" disabled={mutate.isPending} onClick={() => reorder(c.id, c.sortOrder)} aria-label={`Reorder ${c.name}`}>
          Reorder
        </button>
        <button
          type="button"
          className="biz-btn text-xs"
          disabled={mutate.isPending}
          onClick={() => void run({ kind: "update", id: c.id, body: { isActive: !c.isActive } })}
          aria-label={`${c.isActive ? "Switch off" : "Switch on"} ${c.name}`}
        >
          {c.isActive ? "Switch off" : "Switch on"}
        </button>
      </span>
    </li>
  );

  const slugOk = SLUG.test(slug);
  return (
    <details className="cu-filter mt-2 text-xs" data-testid="category-manager">
      <summary className="cursor-pointer font-semibold">Manage categories</summary>
      {error ? (
        <p className="mt-2 text-[var(--color-biz-warning)]" role="alert">
          {error}
        </p>
      ) : null}
      {taxonomy.isLoading ? (
        <p className="mt-2 text-[var(--color-biz-muted)]">Loading…</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {categories.map((c) => (
            <li key={c.id}>
              <ul className="space-y-1">
                {row(c, false)}
                {c.subcategories.map((s) => row(s, true))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      <form
        className="mt-3 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim() || !slugOk) return;
          void run({ kind: "create", body: { name: name.trim(), slug, parentId: parentId || null } }).then(() => {
            setName("");
            setSlug("");
          });
        }}
      >
        <label className="text-[var(--color-biz-muted)]">
          New category name
          <input className="sv-input mt-1" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
        </label>
        <label className="text-[var(--color-biz-muted)]">
          URL slug (cannot be changed later)
          <input
            className="sv-input mt-1"
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase())}
            maxLength={80}
            required
            aria-invalid={slug.length > 0 && !slugOk}
            aria-describedby="category-slug-hint"
          />
        </label>
        <label className="text-[var(--color-biz-muted)]">
          Under
          <select className="sv-input mt-1" value={parentId} onChange={(e) => setParentId(e.target.value)}>
            <option value="">Top level</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="biz-btn text-xs" disabled={mutate.isPending || !name.trim() || !slugOk}>
          Add category
        </button>
        <p id="category-slug-hint" className="basis-full text-[var(--color-biz-muted)]">
          Lowercase letters, digits and single hyphens. A category that still holds a live service cannot be switched off.
        </p>
      </form>
    </details>
  );
}
